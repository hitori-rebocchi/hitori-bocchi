import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { createWriteStream, WriteStream } from 'fs'
import { app, BrowserWindow } from 'electron'
import { settingsService } from './settingsService'
import { getSidecarPath } from '../utils/sidecarPath'

export class ModToolsWrapper {
  private profilesPath: string
  private installedPath: string
  private runningProcess: ChildProcess | null = null
  private mainWindow: BrowserWindow | null = null
  private activeProcesses: ChildProcess[] = []
  private timeout: number = 300000 // Default 5 minutes in milliseconds
  private isCancelled: boolean = false
  private currentOperation: ChildProcess | null = null
  private applyInProgress: boolean = false
  private importedMods: string[] = [] // Track successfully imported mods for cleanup
  private stopRequested: boolean = false // Suppresses exit-code errors on intentional kills
  private eolNotified: boolean = false // The DLL repeats its EOL line; notify the UI once per run
  private recentStderr: string[] = [] // Tail of patcher stderr for exit diagnostics
  private patcherLog: WriteStream | null = null // Persistent per-apply log (survives crashes/BSOD)

  constructor() {
    const userData = app.getPath('userData')
    this.profilesPath = path.join(userData, 'profiles')
    this.installedPath = path.join(userData, 'cslol_installed')
  }

  setToolsTimeout(seconds: number): void {
    this.timeout = seconds * 1000 // Convert seconds to milliseconds
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  private async forceKillStaleProcesses(): Promise<void> {
    await new Promise<void>((resolve) => {
      const proc = spawn('taskkill', ['/F', '/IM', 'ltk-manager.exe'])
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
  }

  async checkDllExist(): Promise<boolean> {
    try {
      const toolsPath = settingsService.getModToolsPath()
      if (!toolsPath) return false
      const dllTargetPath = path.join(toolsPath, 'cslol-dll.dll')
      await fs.access(dllTargetPath)
      return true
    } catch {
      return false
    }
  }

  async installDllFromFile(
    sourcePath: string
  ): Promise<{ success: true } | { success: false; error: string }> {
    const toolsPath = settingsService.getModToolsPath()
    if (!toolsPath) return { success: false, error: 'Tools path not configured' }
    try {
      const stat = await fs.stat(sourcePath)
      if (!stat.isFile()) return { success: false, error: 'Source is not a file' }
      const target = path.join(toolsPath, 'cslol-dll.dll')
      await fs.copyFile(sourcePath, target)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to copy DLL'
      }
    }
  }

  private async execToolWithTimeout(
    command: string,
    args: string[],
    timeout: number,
    sendProgress: boolean = false
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if cancelled before starting
      if (this.isCancelled) {
        reject(new Error('Operation cancelled by user'))
        return
      }

      const process = spawn(command, args)
      this.currentOperation = process
      this.activeProcesses.push(process)

      let stdout = ''
      let stderr = ''
      let cancelled = false

      const timer = setTimeout(() => {
        if (!cancelled) {
          process.kill()
          this.cleanupProcess(process)
          this.currentOperation = null
          const timeoutSeconds = Math.round(timeout / 1000)
          reject(new Error(`Process timed out after ${timeoutSeconds} seconds`))
        }
      }, timeout)

      // Check for cancellation periodically
      const cancellationChecker = setInterval(() => {
        if (this.isCancelled && !cancelled) {
          cancelled = true
          clearInterval(cancellationChecker)
          clearTimeout(timer)
          process.kill()
          this.cleanupProcess(process)
          this.currentOperation = null
          reject(new Error('Operation cancelled by user'))
        }
      }, 100) // Check every 100ms

      process.stdout.on('data', (data) => {
        const output = data.toString()
        stdout += output

        const lines = output.split('\n').filter((line) => line.trim())
        lines.forEach((line) => {
          const trimmedLine = line.trim()
          this.logToFile(trimmedLine)
          // Send progress to renderer if requested
          if (sendProgress && this.mainWindow && !this.mainWindow.isDestroyed()) {
            console.log(`[MOD-TOOLS]: ${trimmedLine}`)
            this.mainWindow!.webContents.send('patcher-status', trimmedLine)
          }
        })
      })

      process.stderr.on('data', (data) => {
        const output = data.toString()
        stderr += output

        const lines = output.split('\n').filter((line) => line.trim())
        lines.forEach((line) => {
          const trimmedLine = line.trim()
          this.logToFile(`[stderr] ${trimmedLine}`)
          // Also send stderr to renderer if it contains status info
          if (
            sendProgress &&
            this.mainWindow &&
            !this.mainWindow.isDestroyed() &&
            (trimmedLine.includes('[INFO]') || trimmedLine.includes('[WARN]'))
          ) {
            console.log(`[MOD-TOOLS]: ${trimmedLine}`)
            this.mainWindow!.webContents.send('patcher-status', trimmedLine)
          }
        })
      })

      process.on('close', (code) => {
        clearTimeout(timer)
        clearInterval(cancellationChecker)
        this.cleanupProcess(process)
        this.currentOperation = null

        if (cancelled) {
          reject(new Error('Operation cancelled by user'))
        } else if (code === 0) {
          resolve(stdout)
        } else {
          // Full stderr can be hundreds of lines; the tail has the actual error.
          const tail = stderr
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-5)
            .join('\n')
          reject(new Error(`Process exited with code ${code}: ${tail}`))
        }
      })

      process.on('error', (err) => {
        clearTimeout(timer)
        clearInterval(cancellationChecker)
        this.cleanupProcess(process)
        this.currentOperation = null
        reject(err)
      })
    })
  }

  async applyPreset(preset: any): Promise<{ success: boolean; message: string }> {
    this.isCancelled = false
    this.applyInProgress = true
    this.importedMods = []
    this.eolNotified = false
    this.recentStderr = []

    try {
      await this.stopOverlay()
      await this.openPatcherLog()
      this.logToFile(`[APPLY] start: ${(preset.selectedSkins || []).length} skin(s)`)

      console.debug('[ModToolsWrapper] Preparing directories')
      await fs.rm(this.profilesPath, { recursive: true, force: true }).catch(() => {})
      await fs.mkdir(this.profilesPath, { recursive: true })

      // Create installed directory if it doesn't exist (don't clean it to preserve imported mods)
      await fs.mkdir(this.installedPath, { recursive: true }).catch(() => {})

      const gamePath = path.normalize(preset.gamePath)
      try {
        await fs.access(gamePath)
      } catch {
        throw new Error(`Game directory not found`)
      }

      const validSkinMods = preset.selectedSkins || []
      if (!Array.isArray(validSkinMods) || validSkinMods.length === 0) {
        return { success: false, message: 'No skins selected' }
      }

      const profileName = `preset_${preset.id}`
      const profilePath = path.join(this.profilesPath, profileName)

      // Check for cancellation before creating overlay
      if (this.isCancelled) {
        throw new Error('Operation cancelled by user')
      }

      console.info('[ModToolsWrapper] Creating overlay via bocchi-overlay...')
      const overlayBinForBuild = getSidecarPath()
      try {
        await fs.access(overlayBinForBuild)
      } catch {
        throw new Error(
          `bocchi-overlay sidecar not found at ${overlayBinForBuild}. Build it with: cargo build --release --manifest-path native/bocchi-overlay/Cargo.toml`
        )
      }

      // State directory for the sidecar's persistent caches/indices.
      const overlayStateDir = `${profilePath}.state`

      // Pull the actual .fantome paths from validSkinMods. Each entry is
      // either a string path or an object with .localPath.
      const fantomePaths: string[] = []
      for (const entry of validSkinMods) {
        if (typeof entry === 'string') {
          fantomePaths.push(entry)
        } else if (entry && typeof entry.localPath === 'string') {
          fantomePaths.push(entry.localPath)
        }
      }
      if (fantomePaths.length === 0) {
        throw new Error('No fantome archive paths available for overlay build')
      }
      console.info(`[ModToolsWrapper] Overlay inputs: ${fantomePaths.length} fantome(s)`)

      const mkoverlayArgs = [
        'mkoverlay',
        '--game',
        path.normalize(preset.gamePath),
        '--overlay',
        path.normalize(profilePath),
        '--state',
        path.normalize(overlayStateDir),
        ...fantomePaths.flatMap((p) => ['--mod', p])
      ]
      console.debug('[ModToolsWrapper] Executing bocchi-overlay mkoverlay')
      await this.execToolWithTimeout(overlayBinForBuild, mkoverlayArgs, this.timeout, true)
      console.info('[ModToolsWrapper] Overlay created successfully')

      // Check for cancellation before starting runoverlay
      if (this.isCancelled) {
        throw new Error('Operation cancelled by user')
      }

      const toolsPath = settingsService.getModToolsPath()
      if (!toolsPath) {
        throw new Error('Mod tools path not found')
      }
      const dllProbe = path.join(toolsPath, 'cslol-dll.dll')
      try {
        await fs.access(dllProbe)
      } catch {
        throw new Error(
          `cslol-dll.dll not found at ${dllProbe}. Use the "Browse for DLL" button in the tools modal to install it.`
        )
      }
      const sidecarBin = getSidecarPath()
      try {
        await fs.access(sidecarBin)
      } catch {
        throw new Error(
          `Sidecar not found at ${sidecarBin}. Build it with: cargo build --release --manifest-path native/bocchi-overlay/Cargo.toml`
        )
      }

      console.info('[ModToolsWrapper] Starting patcher via ltk-manager sidecar')
      this.logToFile('[APPLY] overlay built, starting patcher')
      // Reset here (not at apply start) so the exit event of the previous
      // patcher — killed by stopOverlay above — is still treated as intentional.
      this.stopRequested = false
      this.runningProcess = spawn(
        sidecarBin,
        [
          'patcher',
          '--dll',
          dllProbe,
          '--overlay-root',
          path.normalize(profilePath),
          '--flags',
          '0'
        ],
        { detached: false, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      this.activeProcesses.push(this.runningProcess)

      this.runningProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((line) => line.trim())

        lines.forEach((line) => {
          const trimmedLine = line.trim()
          console.log(`[MOD-TOOLS]: ${trimmedLine}`)
          this.logToFile(trimmedLine)

          // Surface fatal/injection diagnostics (incl. the otherwise-filtered
          // [DLL] lines) before dropping the rest of the [DLL] firehose.
          const isDiagnostic = this.emitPatcherDiagnostics(trimmedLine)
          if (!isDiagnostic && !trimmedLine.startsWith('[DLL]')) {
            this.sendToRenderer('patcher-status', trimmedLine)
          }
        })
      })

      this.runningProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((line) => line.trim())

        lines.forEach((line) => {
          const trimmedLine = line.trim()
          console.error(`[MOD-TOOLS ERROR]: ${trimmedLine}`)
          this.logToFile(`[stderr] ${trimmedLine}`)
          this.recentStderr = [...this.recentStderr.slice(-9), trimmedLine]

          // Only explicit [ERROR] lines (handled above) reach the error panel;
          // everything else is progress noise, forwarded as status.
          const isDiagnostic = this.emitPatcherDiagnostics(trimmedLine)
          if (!isDiagnostic && !trimmedLine.startsWith('[DLL]')) {
            this.sendToRenderer('patcher-status', trimmedLine)
          }
        })
      })

      this.runningProcess.on('exit', (code) => {
        console.log(`Mod tools process exited with code ${code}`)
        this.logToFile(`[APPLY] patcher exited with code ${code}`)
        this.closePatcherLog()
        this.cleanupProcess(this.runningProcess)
        this.runningProcess = null

        // An exit nobody asked for means injection died (crash, Vanguard kill,
        // sidecar panic) — surface it instead of silently going idle.
        if (!this.stopRequested && code !== 0) {
          const tail = this.recentStderr.slice(-3).join(' | ')
          this.sendToRenderer(
            'patcher-error',
            `Patcher exited unexpectedly (code ${code ?? 'killed'})${tail ? `: ${tail}` : ''}`
          )
        }
        this.sendToRenderer('patcher-status', '')
      })

      this.applyInProgress = false
      return { success: true, message: 'Preset applied successfully' }
    } catch (error) {
      console.error('Failed to apply preset:', error)
      this.logToFile(`[APPLY] failed: ${error instanceof Error ? error.message : error}`)
      this.closePatcherLog()
      this.applyInProgress = false

      // Send cancellation status to renderer if cancelled
      if (this.isCancelled && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('apply-cancelled')
      }

      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload)
    }
  }

  // Per-apply log written to disk so there's a trace even if the machine
  // crashes mid-injection (e.g. the BSOD-on-apply reports).
  private async openPatcherLog(): Promise<void> {
    try {
      const logDir = path.join(app.getPath('userData'), 'logs')
      await fs.mkdir(logDir, { recursive: true })
      this.patcherLog?.end()
      this.patcherLog = createWriteStream(path.join(logDir, 'patcher-last.log'), { flags: 'w' })
    } catch {
      this.patcherLog = null
    }
  }

  private logToFile(line: string): void {
    this.patcherLog?.write(`${new Date().toISOString()} ${line}\n`)
  }

  private closePatcherLog(): void {
    this.patcherLog?.end()
    this.patcherLog = null
  }

  // Inspect a runtime patcher log line for conditions the user needs to see.
  // Returns true when the line was an EOL/error so callers skip emitting it as
  // a normal status update.
  private emitPatcherDiagnostics(line: string): boolean {
    // EOL kill-switch: the DLL refuses to inject once the game build passes the
    // baked-in end-of-life marker. Route to a dedicated event so the UI can
    // explain that an updated DLL is required and skins won't inject until then.
    // The DLL repeats the line on every injection attempt — notify once per run
    // so the dialog doesn't reopen after the user dismissed it.
    if (line.includes('EOL_TIMESTAMP') || line.includes('End of life reached')) {
      if (!this.eolNotified) {
        this.eolNotified = true
        const match = line.match(/please update:\s*([0-9A-Fa-f]+)/)
        this.sendToRenderer('patcher-dll-eol', { build: match ? match[1] : null, raw: line })
      }
      return true
    }
    // Rust panics from the sidecar carry no [ERROR] tag but are always fatal.
    if (/panicked at|thread '[^']*' panicked|fatal runtime error/.test(line)) {
      this.sendToRenderer('patcher-error', line)
      return true
    }
    // Only lines with an explicit [ERROR] tag are real failures — the patcher
    // firehose mentions "error" in plenty of progress lines (e.g. "0 errors").
    if (/\[error\]/i.test(line) || /\[err\]/i.test(line)) {
      this.sendToRenderer('patcher-error', line)
      return true
    }
    return false
  }

  private cleanupProcess(process: ChildProcess | null) {
    if (!process) return
    const index = this.activeProcesses.indexOf(process)
    if (index > -1) {
      this.activeProcesses.splice(index, 1)
    }
  }

  async stopOverlay(): Promise<void> {
    this.stopRequested = true
    if (this.runningProcess) {
      this.runningProcess.stdin?.write('\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (this.runningProcess && !this.runningProcess.killed) {
        this.runningProcess.kill()
      }
      this.runningProcess = null
    }
    await this.forceKillStaleProcesses()
  }

  isRunning(): boolean {
    return this.runningProcess !== null && !this.runningProcess.killed
  }

  async clearImportedModsCache(): Promise<void> {
    try {
      console.info('[ModToolsWrapper] Clearing imported mods cache')
      await fs.rm(this.installedPath, { recursive: true, force: true })
      console.info('[ModToolsWrapper] Imported mods cache cleared successfully')
    } catch (error) {
      console.error('[ModToolsWrapper] Failed to clear imported mods cache:', error)
      throw error
    }
  }

  async clearSkinCache(skinName: string): Promise<void> {
    try {
      console.info(`[ModToolsWrapper] Clearing cache for skin: ${skinName}`)

      // Remove file extension if present
      const baseName = path.basename(skinName, path.extname(skinName)).trim()

      // Read all directories in the installed path
      const installedDirs = await fs.readdir(this.installedPath).catch(() => [])

      // Find and remove any cached versions of this skin
      let clearedCount = 0
      for (const dir of installedDirs) {
        // Check if this directory is for the skin we want to clear
        // It could be named like "mod_0_skinname" or just contain the skin name
        if (dir.includes(baseName)) {
          const dirPath = path.join(this.installedPath, dir)
          try {
            await fs.rm(dirPath, { recursive: true, force: true })
            console.info(`[ModToolsWrapper] Cleared cached mod: ${dir}`)
            clearedCount++
          } catch (error) {
            console.warn(`[ModToolsWrapper] Failed to clear ${dir}:`, error)
          }
        }
      }

      if (clearedCount > 0) {
        console.info(
          `[ModToolsWrapper] Successfully cleared ${clearedCount} cached version(s) of ${skinName}`
        )
      } else {
        console.info(`[ModToolsWrapper] No cached versions found for ${skinName}`)
      }
    } catch (error) {
      console.error(`[ModToolsWrapper] Failed to clear cache for ${skinName}:`, error)
      // Don't throw - this is a non-critical operation
    }
  }

  async getCacheInfo(): Promise<{ exists: boolean; modCount: number; sizeInMB: number }> {
    try {
      await fs.access(this.installedPath)

      const dirs = await fs.readdir(this.installedPath)
      let totalSize = 0
      let modCount = 0

      for (const dir of dirs) {
        const dirPath = path.join(this.installedPath, dir)
        const stats = await fs.stat(dirPath)

        if (stats.isDirectory()) {
          modCount++
          // Estimate directory size (simplified - just counts direct files)
          const files = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
          for (const file of files) {
            if (file.isFile()) {
              const filePath = path.join(dirPath, file.name)
              const fileStats = await fs.stat(filePath).catch(() => null)
              if (fileStats) {
                totalSize += fileStats.size
              }
            }
          }
        }
      }

      return {
        exists: true,
        modCount,
        sizeInMB: Math.round((totalSize / (1024 * 1024)) * 10) / 10 // Round to 1 decimal
      }
    } catch {
      return { exists: false, modCount: 0, sizeInMB: 0 }
    }
  }

  async cancelApply(): Promise<{ success: boolean; message: string }> {
    if (!this.applyInProgress) {
      return { success: false, message: 'No apply operation in progress' }
    }

    console.info('[ModToolsWrapper] Cancelling apply operation...')
    this.isCancelled = true
    this.stopRequested = true

    // Kill current operation if running
    if (this.currentOperation) {
      console.info('[ModToolsWrapper] Killing current operation')
      this.currentOperation.kill()
      this.currentOperation = null
    }

    // Kill all active processes
    for (const process of this.activeProcesses) {
      if (!process.killed) {
        process.kill()
      }
    }
    this.activeProcesses = []

    await this.forceKillStaleProcesses()

    // Optionally cleanup partially imported mods
    if (this.importedMods.length > 0) {
      console.info(
        `[ModToolsWrapper] Cleaning up ${this.importedMods.length} partially imported mods`
      )
      for (const modName of this.importedMods) {
        try {
          const modPath = path.join(this.installedPath, modName)
          await fs.rm(modPath, { recursive: true, force: true }).catch(() => {})
        } catch (error) {
          console.warn(`[ModToolsWrapper] Failed to cleanup ${modName}:`, error)
        }
      }
    }

    // Reset state
    this.applyInProgress = false
    this.importedMods = []

    // Notify renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('patcher-status', 'Apply operation cancelled')
    }

    return { success: true, message: 'Apply operation cancelled successfully' }
  }

  isApplying(): boolean {
    return this.applyInProgress
  }
}
