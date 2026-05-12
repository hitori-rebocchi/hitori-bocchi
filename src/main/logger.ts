/**
 * Centralized logging for the main process.
 *
 * Redirects console.{log,info,warn,error,debug} from the main process and
 * everything imported into it to %APPDATA%/bocchi/logs/main.log on Windows.
 * Also keeps the original console transport so dev mode keeps its terminal
 * output. Renderer-side logs continue to go to DevTools — those aren't
 * captured here.
 *
 * Why redirect console.* instead of asking every service to import the
 * logger? Because services like ModToolsWrapper already pipe the
 * bocchi-overlay sidecar's stdout/stderr through console.log/error, and
 * those are the lines we most want in the log file. Redirecting at the
 * console level captures everything without touching call sites.
 */
import log from 'electron-log/main'
import path from 'path'
import { app } from 'electron'

let initialized = false

export function initMainLogger(): void {
  if (initialized) return
  initialized = true

  // %APPDATA%/bocchi/logs/main.log on Windows. resolvePathFn is the v5 API.
  log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')

  // 5 MB rolling file. Old log gets `.old` appended.
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope}{text}'
  log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {scope}{text}'

  log.initialize()

  // Wraps console.{log,info,warn,error,debug,trace} so everything that
  // writes to console also lands in the file.
  Object.assign(console, log.functions)

  log.info('===== Bocchi main process started =====')
  log.info(`Version: ${app.getVersion()}`)
  log.info(`Platform: ${process.platform} ${process.arch}`)
  log.info(`Electron: ${process.versions.electron}`)
  log.info(`Node: ${process.versions.node}`)
  log.info(`userData: ${app.getPath('userData')}`)
  log.info(`Log file: ${log.transports.file.getFile().path}`)
}

export { log }
