import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { app, BrowserWindow } from 'electron'
import { Preset } from '../types'
import { ToolsDownloader } from './toolsDownloader'

export class ModToolsWrapper {
  private modToolsPath: string
  private profilesPath: string
  private runningProcess: ChildProcess | null = null
  private mainWindow: BrowserWindow | null = null

  constructor() {
    // Get mod-tools path from ToolsDownloader
    const toolsDownloader = new ToolsDownloader()
    const toolsPath = toolsDownloader.getToolsPath()
    this.modToolsPath = path.join(toolsPath, 'mod-tools.exe')

    const userData = app.getPath('userData')
    this.profilesPath = path.join(userData, 'profiles')
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  async checkModToolsExist(): Promise<boolean> {
    try {
      await fs.access(this.modToolsPath, fs.constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async applyPreset(preset: Preset): Promise<{ success: boolean; message: string }> {
    try {
      // Check if mod tools exist
      const toolsExist = await this.checkModToolsExist()
      if (!toolsExist) {
        return { success: false, message: 'CS:LOL tools not found. Please download them first.' }
      }

      // Stop any running overlay first
      await this.stopOverlay()

      // Create profile directory if it doesn't exist
      await fs.mkdir(this.profilesPath, { recursive: true })

      const profileName = `preset_${preset.id}`
      const modsPath = path.join(app.getPath('userData'), 'mods')

      // Map skin keys to mod folder names
      const selectedSkins = preset.selectedSkins || preset.selectedMods || []
      const modNames: string[] = []

      for (const skinKey of selectedSkins) {
        const [champion, skinFile] = skinKey.split('/')
        if (champion && skinFile) {
          const modName = skinFile.replace('.zip', '')
          modNames.push(`${champion}_${modName}`)
        }
      }

      if (modNames.length === 0) {
        return { success: false, message: 'No skins selected' }
      }

      const modsArg = modNames.join('/')

      // Create overlay using mkoverlay command
      await this.runCommand(
        [
          'mkoverlay',
          modsPath,
          path.join(this.profilesPath, profileName),
          `--game:${preset.gamePath}`,
          `--mods:${modsArg}`,
          preset.noTFT ? '--noTFT' : '',
          preset.ignoreConflict ? '--ignoreConflict' : ''
        ].filter((arg) => arg !== '')
      )

      // Run the overlay
      this.runningProcess = spawn(
        this.modToolsPath,
        [
          'runoverlay',
          path.join(this.profilesPath, profileName),
          path.join(this.profilesPath, `${profileName}.config`),
          `--game:${preset.gamePath}`,
          '--opts:none'
        ],
        {
          detached: false,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )

      this.runningProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim()
        console.log(`[MOD-TOOLS]: ${output}`)

        // Parse and send status messages to renderer
        if (output.startsWith('Status: ')) {
          const status = output.substring(8)
          console.log(`[MOD-TOOLS IPC] Sending patcher-status: ${status}`)
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('patcher-status', status)
          } else {
            console.error('[MOD-TOOLS IPC] No main window available to send status')
          }
        } else if (output.startsWith('[DLL] ')) {
          const message = output.substring(6)

          // Only allow specific status messages
          const allowedMessages = [
            'Waiting for league match to start',
            'Found League',
            'Wait initialized',
            'Scanning',
            'Saving',
            'Wait patchable',
            'Patching',
            'Waiting for exit',
            'League exited'
          ]

          if (allowedMessages.includes(message)) {
            console.log(`[MOD-TOOLS IPC] Sending patcher-message: ${message}`)
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('patcher-message', message)
            } else {
              console.error('[MOD-TOOLS IPC] No main window available to send message')
            }
          } else {
            console.log(`[MOD-TOOLS IPC] Filtered out message: ${message}`)
          }
        }
      })

      this.runningProcess.stderr?.on('data', (data) => {
        const error = data.toString().trim()
        console.error(`[MOD-TOOLS ERROR]: ${error}`)
        console.log(`[MOD-TOOLS IPC] Sending patcher-error: ${error}`)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('patcher-error', error)
        } else {
          console.error('[MOD-TOOLS IPC] No main window available to send error')
        }
      })

      this.runningProcess.on('exit', (code) => {
        console.log(`Mod tools process exited with code ${code}`)
        this.runningProcess = null

        // Send a clear status message when patcher exits
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('patcher-status', '')
        }
      })

      return { success: true, message: 'Preset applied successfully' }
    } catch (error) {
      console.error('Failed to apply preset:', error)
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async stopOverlay(): Promise<void> {
    if (this.runningProcess) {
      // Send newline to trigger exit
      this.runningProcess.stdin?.write('\n')

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Force kill if still running
      if (this.runningProcess && !this.runningProcess.killed) {
        this.runningProcess.kill()
      }

      this.runningProcess = null
    }
  }

  isRunning(): boolean {
    return this.runningProcess !== null && !this.runningProcess.killed
  }

  private runCommand(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.modToolsPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stderr = ''

      process.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`))
        }
      })

      process.on('error', (error) => {
        reject(error)
      })
    })
  }
}
