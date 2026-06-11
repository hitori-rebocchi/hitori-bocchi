import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { createReadStream, createWriteStream, WriteStream } from 'fs'
import { app, BrowserWindow } from 'electron'
import JSZip from 'jszip'
import * as StreamZip from 'node-stream-zip'
import { settingsService } from './settingsService'
import { getSidecarPath } from '../utils/sidecarPath'

export interface FantomeInfo {
  Name: string
  Author: string
  Version: string
  Description: string
}

// The mkoverlay sidecar does a strict parse: META/info.json at archive root
// with these four exact-case string fields, plus wad-named files under WAD/.
const WAD_ENTRY_REGEX = /\.wad(\.client|\.mobile)?$/i
const REQUIRED_INFO_FIELDS = ['Name', 'Author', 'Version', 'Description'] as const

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function normalizeFantomeInfo(raw: unknown, fallbackName: string): FantomeInfo {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (key: string): string | undefined => {
    const value = src[key] ?? src[key.toLowerCase()]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return {
    Name: pick('Name') || fallbackName,
    Author: pick('Author') || 'Unknown',
    Version: pick('Version') || '1.0.0',
    Description: pick('Description') || ''
  }
}

export function hasStrictFantomeInfo(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const info = raw as Record<string, unknown>
  return REQUIRED_INFO_FIELDS.every((field) => typeof info[field] === 'string')
}

export function ensureWadClientName(fileName: string): string {
  if (/\.wad\.(client|mobile)$/i.test(fileName)) return fileName
  if (/\.wad$/i.test(fileName)) return `${fileName}.client`
  return `${fileName}.wad.client`
}

export async function assertZipEntriesSafe(
  zip: StreamZip.StreamZipAsync,
  targetDir: string
): Promise<void> {
  const root = path.resolve(targetDir)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const fold = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value
  const entries = await zip.entries()
  for (const entryName of Object.keys(entries)) {
    const resolved = path.resolve(root, entryName)
    if (fold(resolved) !== fold(root) && !fold(resolved).startsWith(fold(prefix))) {
      throw new Error(`Archive entry escapes extraction directory: ${entryName}`)
    }
  }
}

async function writeZipToFile(zip: JSZip, outFile: string): Promise<void> {
  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    zip
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
      .pipe(createWriteStream(outFile))
      .on('finish', () => resolve())
      .on('error', reject)
  })
}

export async function buildFantomeFromWad(
  wadPath: string,
  outFile: string,
  info: FantomeInfo
): Promise<void> {
  const zip = new JSZip()
  zip.file('META/info.json', JSON.stringify(info, null, 2))
  zip.file(`WAD/${ensureWadClientName(path.basename(wadPath))}`, createReadStream(wadPath))
  await writeZipToFile(zip, outFile)
}

async function isWadFileBySignature(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(2)
      const { bytesRead } = await handle.read(buffer, 0, 2, 0)
      return bytesRead === 2 && buffer[0] === 0x52 && buffer[1] === 0x57
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

async function addDirToZip(zip: JSZip, dir: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await addDirToZip(zip, absPath, `${zipPrefix}/${entry.name}`)
    } else if (entry.isFile()) {
      zip.file(`${zipPrefix}/${entry.name}`, createReadStream(absPath))
    }
  }
}

async function resolveFantomeContentRoot(srcDir: string): Promise<string> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  if (entries.some((e) => e.isDirectory() && /^(meta|wad|raw)$/i.test(e.name))) return srcDir
  const dirs = entries.filter((e) => e.isDirectory())
  if (dirs.length === 1) {
    const inner = path.join(srcDir, dirs[0].name)
    const innerEntries = await fs.readdir(inner, { withFileTypes: true })
    if (innerEntries.some((e) => e.isDirectory() && /^(meta|wad)$/i.test(e.name))) return inner
  }
  return srcDir
}

export async function buildFantomeFromDirectory(
  srcDir: string,
  outFile: string,
  fallbackName: string
): Promise<void> {
  const root = await resolveFantomeContentRoot(srcDir)
  const dirNames = new Map<string, string>()
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) dirNames.set(entry.name.toLowerCase(), entry.name)
  }

  const wadDirName = dirNames.get('wad')
  if (!wadDirName) {
    throw new Error('no WAD folder found in mod')
  }

  let rawInfo: unknown = null
  const metaDirName = dirNames.get('meta')
  if (metaDirName) {
    try {
      const content = await fs.readFile(path.join(root, metaDirName, 'info.json'), 'utf-8')
      rawInfo = JSON.parse(stripBom(content))
    } catch {
      rawInfo = null
    }
  }

  const zip = new JSZip()
  zip.file('META/info.json', JSON.stringify(normalizeFantomeInfo(rawInfo, fallbackName), null, 2))

  if (metaDirName) {
    const metaDir = path.join(root, metaDirName)
    for (const entry of await fs.readdir(metaDir, { withFileTypes: true })) {
      if (entry.name.toLowerCase() === 'info.json') continue
      const absPath = path.join(metaDir, entry.name)
      if (entry.isDirectory()) {
        await addDirToZip(zip, absPath, `META/${entry.name}`)
      } else if (entry.isFile()) {
        zip.file(`META/${entry.name}`, createReadStream(absPath))
      }
    }
  }

  let wadCount = 0
  const wadDir = path.join(root, wadDirName)
  for (const entry of await fs.readdir(wadDir, { withFileTypes: true })) {
    const absPath = path.join(wadDir, entry.name)
    if (entry.isDirectory()) {
      // Loose-tree layout: WAD/<name>.wad.client/ is a directory of override
      // files (our bins-only format). Carry the whole subtree verbatim.
      if (WAD_ENTRY_REGEX.test(entry.name)) {
        await addDirToZip(zip, absPath, `WAD/${entry.name}`)
        wadCount++
      }
      continue
    }
    if (!entry.isFile()) continue
    if (WAD_ENTRY_REGEX.test(entry.name)) {
      zip.file(`WAD/${entry.name}`, createReadStream(absPath))
      wadCount++
    } else if (await isWadFileBySignature(absPath)) {
      zip.file(`WAD/${ensureWadClientName(entry.name)}`, createReadStream(absPath))
      wadCount++
    }
  }
  if (wadCount === 0) {
    throw new Error('no .wad content found under WAD/')
  }

  const rawDirName = dirNames.get('raw')
  if (rawDirName) {
    await addDirToZip(zip, path.join(root, rawDirName), 'RAW')
  }

  await writeZipToFile(zip, outFile)
}

type ZipModCheck = { status: 'valid' | 'repairable' } | { status: 'invalid'; reason: string }

async function inspectFantomeZip(zipPath: string): Promise<ZipModCheck> {
  let zip: StreamZip.StreamZipAsync | null = null
  try {
    zip = new StreamZip.async({ file: zipPath })
    const entries = Object.values(await zip.entries())
    const fileNames = entries.filter((e) => !e.isDirectory).map((e) => e.name.replace(/\\/g, '/'))
    if (fileNames.length === 0) return { status: 'invalid', reason: 'archive is empty' }

    const prefixes = ['']
    const topSegments = new Set(fileNames.map((n) => n.split('/')[0]))
    if (topSegments.size === 1 && fileNames.every((n) => n.includes('/'))) {
      prefixes.push(`${[...topSegments][0]}/`)
    }

    for (const prefix of prefixes) {
      const infoEntry = fileNames.find(
        (n) => n.toLowerCase() === `${prefix.toLowerCase()}meta/info.json`
      )
      // Accept both layouts the sidecar supports: a packed wad FILE directly
      // under WAD/ (parts.length === 2), and a loose tree where the wad name
      // is a DIRECTORY containing override files (our bins-only generated
      // format: WAD/<name>.wad.client/data/.../skin0.bin). The wad-name is the
      // first path segment after WAD/ in both cases.
      const wadFiles = fileNames.filter((n) => {
        if (!n.toLowerCase().startsWith(`${prefix.toLowerCase()}wad/`)) return false
        const rel = n.slice(prefix.length)
        const parts = rel.split('/')
        return parts.length >= 2 && WAD_ENTRY_REGEX.test(parts[1])
      })
      if (!infoEntry && wadFiles.length === 0) continue
      if (wadFiles.length === 0) {
        return { status: 'invalid', reason: 'no .wad files under WAD/ in archive' }
      }
      if (
        prefix === '' &&
        infoEntry === 'META/info.json' &&
        wadFiles.every((n) => n.startsWith('WAD/'))
      ) {
        try {
          const data = await zip.entryData('META/info.json')
          const raw = JSON.parse(stripBom(data.toString('utf-8')))
          if (hasStrictFantomeInfo(raw)) return { status: 'valid' }
        } catch {
          // falls through to repair
        }
      }
      return { status: 'repairable' }
    }
    return { status: 'invalid', reason: 'no META/info.json or WAD content found in archive' }
  } catch (error) {
    return {
      status: 'invalid',
      reason: `unreadable archive: ${error instanceof Error ? error.message : error}`
    }
  } finally {
    await zip?.close().catch(() => {})
  }
}

// Returns a path guaranteed to be a sidecar-conforming fantome zip, writing a
// normalized temp copy when needed. Throws with a reason when unfixable.
async function prepareModForOverlay(
  modPath: string,
  tempDir: string,
  index: number
): Promise<string> {
  const stat = await fs.stat(modPath)
  const baseName = path
    .basename(modPath)
    .replace(/\.(wad\.client|wad\.mobile|wad|zip|fantome)$/i, '')

  if (stat.isDirectory()) {
    const outFile = path.join(tempDir, `${index}_${baseName}.fantome`)
    await buildFantomeFromDirectory(modPath, outFile, baseName)
    return outFile
  }

  if (WAD_ENTRY_REGEX.test(modPath)) {
    const outFile = path.join(tempDir, `${index}_${baseName}.fantome`)
    await buildFantomeFromWad(modPath, outFile, normalizeFantomeInfo(null, baseName))
    return outFile
  }

  const check = await inspectFantomeZip(modPath)
  if (check.status === 'valid') return modPath
  if (check.status === 'invalid') throw new Error(check.reason)

  const extractDir = path.join(tempDir, `${index}_extract`)
  await fs.mkdir(extractDir, { recursive: true })
  const zip = new StreamZip.async({ file: modPath })
  try {
    await assertZipEntriesSafe(zip, extractDir)
    await zip.extract(null, extractDir)
  } finally {
    await zip.close()
  }
  const outFile = path.join(tempDir, `${index}_${baseName}.fantome`)
  await buildFantomeFromDirectory(extractDir, outFile, baseName)
  return outFile
}

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
    // Includes legacy sidecar names so upgrades from old versions are covered.
    const staleNames = ['ltk-manager.exe', 'mod-tools.exe', 'bocchi-overlay.exe']
    await Promise.all(
      staleNames.map(
        (name) =>
          new Promise<void>((resolve) => {
            const proc = spawn('taskkill', ['/F', '/IM', name])
            proc.on('close', () => resolve())
            proc.on('error', () => resolve())
          })
      )
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
    if (this.applyInProgress) {
      return { success: false, message: 'An apply operation is already in progress' }
    }

    // Stop the previous patcher before resetting flags so its cancel
    // side-effects don't clobber this run.
    await this.stopOverlay()

    this.isCancelled = false
    this.applyInProgress = true
    this.importedMods = []
    this.eolNotified = false
    this.recentStderr = []

    // Normalized temp copies of non-conforming mods live here for this apply.
    const normalizeRoot = path.join(
      app.getPath('temp'),
      'bocchi-normalized-mods',
      `apply_${Date.now()}`
    )
    const cleanupNormalizedMods = (): void => {
      fs.rm(normalizeRoot, { recursive: true, force: true }).catch(() => {})
    }

    try {
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
        throw new Error('No skins selected')
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

      // Validate/normalize every mod into a sidecar-conforming fantome — one
      // bad mod must not abort the whole apply.
      const skippedMods: { name: string; reason: string }[] = []
      const readyPaths: string[] = []
      for (let i = 0; i < fantomePaths.length; i++) {
        if (this.isCancelled) {
          throw new Error('Operation cancelled by user')
        }
        const modPath = fantomePaths[i]
        try {
          readyPaths.push(await prepareModForOverlay(modPath, normalizeRoot, i))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          console.error(`[ModToolsWrapper] Skipping invalid mod ${modPath}: ${reason}`)
          this.logToFile(`[APPLY] skipping invalid mod ${modPath}: ${reason}`)
          skippedMods.push({ name: path.basename(modPath), reason })
        }
      }
      if (readyPaths.length === 0) {
        throw new Error(
          `No valid mods to apply: ${skippedMods.map((m) => `${m.name} (${m.reason})`).join('; ')}`
        )
      }

      const mkoverlayArgs = [
        'mkoverlay',
        '--game',
        path.normalize(preset.gamePath),
        '--overlay',
        path.normalize(profilePath),
        '--state',
        path.normalize(overlayStateDir),
        ...readyPaths.flatMap((p) => ['--mod', p])
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
      if (this.isCancelled) {
        throw new Error('Operation cancelled by user')
      }
      // Reset here (not at apply start) so the exit event of the previous
      // patcher — killed by stopOverlay above — is still treated as intentional.
      this.stopRequested = false
      const patcherProcess = spawn(
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
      this.runningProcess = patcherProcess
      this.activeProcesses.push(patcherProcess)

      patcherProcess.stdout?.on('data', (data) => {
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

      patcherProcess.stderr?.on('data', (data) => {
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

      patcherProcess.on('exit', (code) => {
        console.log(`Mod tools process exited with code ${code}`)
        this.cleanupProcess(patcherProcess)
        cleanupNormalizedMods()
        // A late exit from a superseded patcher must not touch current state.
        if (this.runningProcess !== patcherProcess) return
        this.logToFile(`[APPLY] patcher exited with code ${code}`)
        this.closePatcherLog()
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
      let message = 'Preset applied successfully'
      if (skippedMods.length > 0) {
        const details = skippedMods.map((m) => `${m.name} (${m.reason})`).join(', ')
        message += `. Skipped ${skippedMods.length} invalid mod(s): ${details}`
      }
      return { success: true, message }
    } catch (error) {
      console.error('Failed to apply preset:', error)
      this.logToFile(`[APPLY] failed: ${error instanceof Error ? error.message : error}`)
      this.closePatcherLog()
      this.applyInProgress = false
      cleanupNormalizedMods()

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
    // Abort an in-flight overlay build too — the cancellation checkpoints in
    // applyPreset read isCancelled, not stopRequested.
    if (this.applyInProgress) {
      this.isCancelled = true
      if (this.currentOperation && !this.currentOperation.killed) {
        this.currentOperation.kill()
      }
    }
    if (this.runningProcess) {
      this.runningProcess.stdin?.write('\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (this.runningProcess && !this.runningProcess.killed) {
        this.runningProcess.kill()
      }
      this.runningProcess = null
      this.closePatcherLog()
      this.sendToRenderer('patcher-status', '')
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
