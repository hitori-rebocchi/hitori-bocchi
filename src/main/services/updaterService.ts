import { autoUpdater, CancellationToken } from 'electron-updater'
import { BrowserWindow } from 'electron'
import path from 'path'
import axios from 'axios'
import { isPackagedApp } from '../utils/isPackagedApp'

export class UpdaterService {
  private mainWindow: BrowserWindow | null = null
  private updateInfo: any = null
  private cancellationToken: CancellationToken | null = null

  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.forceDevUpdateConfig = true
    if (isPackagedApp()) {
      autoUpdater.updateConfigPath = path.join(process.resourcesPath, 'app-update.yml')
    }

    this.setupEventListeners()
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  private setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.sendToWindow('update-checking')
    })

    autoUpdater.on('update-available', (info) => {
      this.updateInfo = info
      this.sendToWindow('update-available', info)
    })

    autoUpdater.on('update-not-available', () => {
      this.sendToWindow('update-not-available')
    })

    autoUpdater.on('error', (err) => {
      this.sendToWindow('update-error', err.message)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendToWindow('update-download-progress', progressObj)
    })

    autoUpdater.on('update-downloaded', () => {
      this.sendToWindow('update-downloaded')
      autoUpdater.quitAndInstall(true, true)
    })
  }

  private sendToWindow(channel: string, data?: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  async checkForUpdates() {
    try {
      const result = await autoUpdater.checkForUpdates()
      return result
    } catch (error) {
      console.error('Error checking for updates:', error)
      throw error
    }
  }

  async downloadUpdate() {
    try {
      this.cancellationToken = new CancellationToken()
      await autoUpdater.downloadUpdate(this.cancellationToken)
    } catch (error) {
      console.error('Error downloading update:', error)
      throw error
    }
  }

  cancelUpdate() {
    if (this.cancellationToken) {
      this.cancellationToken.cancel()
      this.cancellationToken = null
    }
  }

  quitAndInstall() {
    autoUpdater.quitAndInstall()
  }

  async getChangelog(): Promise<string | null> {
    try {
      if (!this.updateInfo || !this.updateInfo.version) {
        return null
      }

      const owner = 'hitori-rebocchi'
      const repo = 'hitori-bocchi'
      const version = this.updateInfo.version

      const url = `https://raw.githubusercontent.com/${owner}/${repo}/v${version}/changes.md`

      try {
        const response = await axios.get(url)
        return response.data
      } catch {
        const mainUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/changes.md`
        const response = await axios.get(mainUrl)
        return response.data
      }
    } catch (error) {
      console.error('Error fetching changelog:', error)
      return null
    }
  }

  getUpdateInfo() {
    return this.updateInfo
  }
}
