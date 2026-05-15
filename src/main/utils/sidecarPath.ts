import path from 'path'
import { app } from 'electron'
import { isPackagedApp } from './isPackagedApp'

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
