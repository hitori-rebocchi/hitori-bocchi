import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import AdmZip from 'adm-zip'
import { SkinInfo } from '../types'

export interface ImportResult {
  success: boolean
  skinInfo?: SkinInfo
  error?: string
}

export interface FileImportOptions {
  championName?: string
  skinName?: string
  imagePath?: string
}

export class FileImportService {
  private modsDir: string
  private tempDir: string

  constructor() {
    const userData = app.getPath('userData')
    this.modsDir = path.join(userData, 'mods')
    this.tempDir = path.join(userData, 'temp-imports')
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.modsDir, { recursive: true })
    await fs.mkdir(this.tempDir, { recursive: true })
  }

  async importFile(filePath: string, options: FileImportOptions = {}): Promise<ImportResult> {
    try {
      const fileType = await this.detectFileType(filePath)

      switch (fileType) {
        case 'wad':
          return await this.importWadFile(filePath, options)
        case 'zip':
        case 'fantome':
          return await this.importZipFile(filePath, options)
        default:
          return { success: false, error: 'Unsupported file type' }
      }
    } catch (error) {
      console.error('Import error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown import error'
      }
    }
  }

  private async detectFileType(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath)

    if (stat.isDirectory()) {
      return 'invalid'
    }

    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.wad') return 'wad'
    if (ext === '.zip') return 'zip'
    if (ext === '.fantome') return 'fantome'

    return 'unknown'
  }

  private async importWadFile(wadPath: string, options: FileImportOptions): Promise<ImportResult> {
    // Use provided championName, even if empty string
    const championName = options.championName !== undefined ? options.championName : ''
    const baseName = path.basename(wadPath, '.wad')
    const skinName = options.skinName || baseName

    const tempExtractPath = path.join(this.tempDir, `${Date.now()}_${skinName}`)

    try {
      await fs.mkdir(tempExtractPath, { recursive: true })

      const metaDir = path.join(tempExtractPath, 'META')
      await fs.mkdir(metaDir, { recursive: true })

      const infoJson = {
        Author: 'User Import',
        Description: `Imported from ${path.basename(wadPath)}`,
        Name: skinName,
        Version: '1.0.0'
      }

      await fs.writeFile(path.join(metaDir, 'info.json'), JSON.stringify(infoJson, null, 2))

      const wadDir = path.join(tempExtractPath, 'WAD')
      await fs.mkdir(wadDir, { recursive: true })
      await fs.copyFile(wadPath, path.join(wadDir, path.basename(wadPath)))

      // Handle custom image if provided
      if (options.imagePath) {
        const imageDir = path.join(tempExtractPath, 'IMAGE')
        await fs.mkdir(imageDir, { recursive: true })
        const imageExt = path.extname(options.imagePath)
        await fs.copyFile(options.imagePath, path.join(imageDir, `preview${imageExt}`))
      }

      const modFolderName = championName ? `${championName}_${skinName}` : `Custom_${skinName}`
      const finalPath = path.join(this.modsDir, modFolderName)

      if (await this.fileExists(finalPath)) {
        await fs.rm(finalPath, { recursive: true, force: true })
      }

      await fs.rename(tempExtractPath, finalPath)

      const skinInfo: SkinInfo = {
        championName: championName || 'Custom',
        skinName: '[User] ' + skinName + '.wad',
        url: `file://${wadPath}`,
        localPath: finalPath,
        source: 'user'
      }

      return { success: true, skinInfo }
    } catch (error) {
      await this.cleanupTemp(tempExtractPath)
      throw error
    }
  }

  private async importZipFile(zipPath: string, options: FileImportOptions): Promise<ImportResult> {
    const fileName = path.basename(zipPath, path.extname(zipPath))
    const tempExtractPath = path.join(this.tempDir, `${Date.now()}_${fileName}`)

    try {
      await fs.mkdir(tempExtractPath, { recursive: true })

      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tempExtractPath, true)

      const metaInfoPath = path.join(tempExtractPath, 'META', 'info.json')
      if (!(await this.fileExists(metaInfoPath))) {
        throw new Error('Invalid mod structure: META/info.json not found')
      }

      // Handle custom image if provided
      if (options.imagePath) {
        const imageDir = path.join(tempExtractPath, 'IMAGE')
        await fs.mkdir(imageDir, { recursive: true })
        const imageExt = path.extname(options.imagePath)
        await fs.copyFile(options.imagePath, path.join(imageDir, `preview${imageExt}`))
      }

      const infoContent = await fs.readFile(metaInfoPath, 'utf-8')
      const info = JSON.parse(infoContent)

      // If championName is provided (even as empty string), use it. Otherwise try to detect.
      let championName = options.championName
      if (championName === undefined) {
        // No option provided at all, try to detect
        const detected = this.extractChampionFromMod(info, fileName)
        championName = detected !== 'Unknown' ? detected : ''
      }
      // If empty string (user selected "No specific champion"), keep it empty
      const skinName = options.skinName || info.Name || fileName

      const modFolderName = championName ? `${championName}_${skinName}` : `Custom_${skinName}`
      const finalPath = path.join(this.modsDir, modFolderName)

      if (await this.fileExists(finalPath)) {
        await fs.rm(finalPath, { recursive: true, force: true })
      }

      await fs.rename(tempExtractPath, finalPath)

      const skinInfo: SkinInfo = {
        championName: championName || 'Custom',
        skinName: '[User] ' + skinName + path.extname(zipPath),
        url: `file://${zipPath}`,
        localPath: finalPath,
        source: 'user'
      }

      return { success: true, skinInfo }
    } catch (error) {
      await this.cleanupTemp(tempExtractPath)
      throw error
    }
  }

  private extractChampionFromMod(info: any, fileName: string): string {
    if (info.Champion) return info.Champion

    const match = fileName.match(/^([A-Za-z]+)[-_\s]/i)
    if (match) return match[1]

    return 'Unknown'
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async cleanupTemp(tempPath: string): Promise<void> {
    try {
      await fs.rm(tempPath, { recursive: true, force: true })
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error)
    }
  }

  async validateFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const fileType = await this.detectFileType(filePath)

      if (fileType === 'unknown' || fileType === 'invalid') {
        return {
          valid: false,
          error: 'Unsupported file type. Supported: .wad, .zip, .fantome'
        }
      }

      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation error'
      }
    }
  }

  async editCustomSkin(
    modPath: string,
    newName: string,
    newImagePath?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Extract the old folder name parts
      const folderName = path.basename(modPath)
      const parts = folderName.split('_')
      if (parts.length < 2) {
        throw new Error('Invalid mod folder structure')
      }

      const championName = parts[0]

      // Create new folder name
      const newFolderName = `${championName}_${newName}`
      const newModPath = path.join(path.dirname(modPath), newFolderName)

      // Rename the folder if name changed
      if (modPath !== newModPath) {
        await fs.rename(modPath, newModPath)
      }

      // Update the image if provided
      if (newImagePath) {
        const imageDir = path.join(newModPath, 'IMAGE')
        await fs.mkdir(imageDir, { recursive: true })

        // Remove old preview images
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']
        for (const ext of imageExtensions) {
          try {
            await fs.unlink(path.join(imageDir, `preview${ext}`))
          } catch {
            // Ignore if file doesn't exist
          }
        }

        // Copy new image
        const ext = path.extname(newImagePath).toLowerCase()
        const destPath = path.join(imageDir, `preview${ext}`)
        await fs.copyFile(newImagePath, destPath)
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async deleteCustomSkin(modPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Delete the mod folder
      await fs.rm(modPath, { recursive: true, force: true })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}
