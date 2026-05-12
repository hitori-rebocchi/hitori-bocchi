import path from 'path'
import { app } from 'electron'
import { isPackagedApp } from './isPackagedApp'

/**
 * Resolve the absolute path to the `bocchi-overlay` sidecar binary.
 *
 * Dev mode:    `native/bocchi-overlay/target/release/bocchi-overlay.exe`
 * Production:  `<resourcesPath>/bocchi-overlay.exe`
 */
export function getBocchiOverlayPath(): string {
  if (!isPackagedApp()) {
    return path.join(
      app.getAppPath(),
      'native',
      'bocchi-overlay',
      'target',
      'release',
      'bocchi-overlay.exe'
    )
  }
  return path.join(process.resourcesPath, 'bocchi-overlay.exe')
}
