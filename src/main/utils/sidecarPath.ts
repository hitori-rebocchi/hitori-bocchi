import path from 'path'
import { app } from 'electron'
import { isPackagedApp } from './isPackagedApp'

/**
 * Resolve the absolute path to the sidecar binary (`ltk-manager.exe`).
 *
 * The Rust crate lives at `native/bocchi-overlay/` but Cargo emits the
 * binary as `ltk-manager.exe` — see `native/bocchi-overlay/Cargo.toml`
 * for the rationale (cslol-dll AH check; memory/cslol_dll_ah_check.md).
 *
 * Dev mode:    `native/bocchi-overlay/target/release/ltk-manager.exe`
 * Production:  `<resourcesPath>/ltk-manager.exe`
 */
export function getSidecarPath(): string {
  if (!isPackagedApp()) {
    return path.join(
      app.getAppPath(),
      'native',
      'bocchi-overlay',
      'target',
      'release',
      'ltk-manager.exe'
    )
  }
  return path.join(process.resourcesPath, 'ltk-manager.exe')
}
