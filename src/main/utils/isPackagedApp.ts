import fs from 'fs'
import path from 'path'

let cached: boolean | undefined

/**
 * Detects whether the main process is running from a packaged build.
 *
 * `app.isPackaged` relies on the host executable's filename, which is
 * unreliable for us because we keep the packaged binary named `electron.exe`
 * (see electron-builder.yml). Instead we check for `resources/app.asar`
 * next to the executable — present in packaged builds, absent in dev.
 * Probed once and cached.
 */
export function isPackagedApp(): boolean {
  if (cached !== undefined) return cached
  try {
    const asarPath = path.join(process.resourcesPath || '', 'app.asar')
    cached = fs.existsSync(asarPath)
  } catch {
    cached = false
  }
  return cached
}
