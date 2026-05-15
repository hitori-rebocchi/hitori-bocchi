import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
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

  private pathContainsOneDrive(filePath: string): boolean {
    return filePath.toLowerCase().includes('onedrive')
  }

  // The patcher runs as ltk-manager.exe (the sidecar's real name; see
  // native/bocchi-overlay/Cargo.toml). mod-tools.exe and bocchi-overlay.exe
  // are legacy names from older installs (pre-cleanup), kept in the kill
  // list so upgrades don't leave a stray process running.
  private async forceKillStaleProcesses(): Promise<void> {
    const targets = ['mod-tools.exe', 'ltk-manager.exe', 'bocchi-overlay.exe']
    await Promise.all(
      targets.map(
        (name) =>
          new Promise<void>((resolve) => {
            const proc = spawn('taskkill', ['/F', '/IM', name])
            proc.on('close', () => resolve())
            proc.on('error', () => resolve())
          })
      )
    )
    console.log(
      `[ModToolsWrapper] Attempted to kill stale patcher processes: ${targets.join(', ')}`
    )
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

  private async ensureCleanDirectoryWithRetry(dirPath: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
        await fs.mkdir(dirPath, { recursive: true })
        return
      } catch (error) {
        console.warn(`[ModToolsWrapper] Clean directory attempt ${i + 1} failed for ${dirPath}`)
        if (i === retries - 1) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000))
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

        // Send progress to renderer if requested
        if (sendProgress && this.mainWindow && !this.mainWindow.isDestroyed()) {
          const lines = output.split('\n').filter((line) => line.trim())
          lines.forEach((line) => {
            const trimmedLine = line.trim()
            console.log(`[MOD-TOOLS]: ${trimmedLine}`)
            this.mainWindow!.webContents.send('patcher-status', trimmedLine)
          })
        }
      })

      process.stderr.on('data', (data) => {
        const output = data.toString()
        stderr += output

        // Also send stderr to renderer if it contains status info
        if (sendProgress && this.mainWindow && !this.mainWindow.isDestroyed()) {
          const lines = output.split('\n').filter((line) => line.trim())
          lines.forEach((line) => {
            const trimmedLine = line.trim()
            if (trimmedLine.includes('[INFO]') || trimmedLine.includes('[WARN]')) {
              console.log(`[MOD-TOOLS]: ${trimmedLine}`)
              this.mainWindow!.webContents.send('patcher-status', trimmedLine)
            }
          })
        }
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
          reject(new Error(`Process exited with code ${code}: ${stderr}`))
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

    try {
      const dllExists = await this.checkDllExist()
      if (!dllExists) {
        return {
          success: false,
          message:
            'cslol-dll.dll not found. Use "Browse for DLL" in the tools modal or download the CS:LOL tools.'
        }
      }

      await this.stopOverlay()

      if (
        this.pathContainsOneDrive(this.installedPath) ||
        this.pathContainsOneDrive(this.profilesPath)
      ) {
        console.warn(
          '[ModToolsWrapper] OneDrive detected in path - this may cause file access issues'
        )
      }

      console.debug('[ModToolsWrapper] Preparing directories')
      await this.ensureCleanDirectoryWithRetry(this.profilesPath)

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

      let overlaySuccess = false
      let mkOverlayError: Error | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            console.info(`[ModToolsWrapper] Retrying overlay creation, attempt ${attempt}/3`)
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
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
          console.debug(`[ModToolsWrapper] Executing bocchi-overlay mkoverlay (attempt ${attempt})`)
          await this.execToolWithTimeout(overlayBinForBuild, mkoverlayArgs, this.timeout, true)
          overlaySuccess = true
          console.info('[ModToolsWrapper] Overlay created successfully')
          break
        } catch (error) {
          mkOverlayError = error as Error
          console.error(
            `[ModToolsWrapper] Overlay creation attempt ${attempt} failed:`,
            error as Error
          )
        }
      }

      if (!overlaySuccess) {
        throw new Error(
          `Failed to create overlay after 3 attempts: ${mkOverlayError?.message || 'Unknown mkoverlay error'}`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, 200))

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

          // Only send to renderer if it's not a DLL log
          if (
            this.mainWindow &&
            !this.mainWindow.isDestroyed() &&
            !trimmedLine.startsWith('[DLL]')
          ) {
            this.mainWindow.webContents.send('patcher-status', trimmedLine)
          }
        })
      })

      this.runningProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((line) => line.trim())

        lines.forEach((line) => {
          const trimmedLine = line.trim()
          console.error(`[MOD-TOOLS ERROR]: ${trimmedLine}`)

          // Only send to renderer if it's not a DLL log
          if (
            this.mainWindow &&
            !this.mainWindow.isDestroyed() &&
            !trimmedLine.startsWith('[DLL]')
          ) {
            this.mainWindow.webContents.send('patcher-error', trimmedLine)
          }
        })
      })

      this.runningProcess.on('exit', (code) => {
        console.log(`Mod tools process exited with code ${code}`)
        this.cleanupProcess(this.runningProcess)
        this.runningProcess = null
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('patcher-status', '')
        }
      })

      this.applyInProgress = false
      return { success: true, message: 'Preset applied successfully' }
    } catch (error) {
      console.error('Failed to apply preset:', error)
      this.applyInProgress = false

      // Send cancellation status to renderer if cancelled
      if (this.isCancelled && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('apply-cancelled')
      }

      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private cleanupProcess(process: ChildProcess | null) {
    if (!process) return
    const index = this.activeProcesses.indexOf(process)
    if (index > -1) {
      this.activeProcesses.splice(index, 1)
    }
  }

  async stopOverlay(): Promise<void> {
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
