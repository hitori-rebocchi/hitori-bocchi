import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import { SkinInfo } from '../types'

export class SkinDownloader {
  private cacheDir: string
  private modsDir: string

  constructor() {
    const userData = app.getPath('userData')
    this.cacheDir = path.join(userData, 'downloaded-skins')
    this.modsDir = path.join(userData, 'mods')
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    await fs.mkdir(this.modsDir, { recursive: true })
  }

  async downloadSkin(url: string): Promise<SkinInfo> {
    // Parse GitHub URL to extract champion and skin name
    const skinInfo = this.parseGitHubUrl(url)

    // Create champion folders
    const championCacheDir = path.join(this.cacheDir, skinInfo.championName)
    await fs.mkdir(championCacheDir, { recursive: true })

    // Define paths
    const zipPath = path.join(championCacheDir, skinInfo.skinName)
    const modName = skinInfo.skinName.replace('.zip', '')
    const modPath = path.join(this.modsDir, `${skinInfo.championName}_${modName}`)
    skinInfo.localPath = modPath

    // Check if already extracted
    try {
      await fs.access(modPath)
      const metaPath = path.join(modPath, 'META', 'info.json')
      await fs.access(metaPath)
      console.log(`Skin already extracted: ${modPath}`)
      return skinInfo
    } catch {
      // Mod doesn't exist or is incomplete, proceed with download
    }

    // Convert blob URL to raw URL for direct download
    const rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')

    console.log(`Downloading skin from: ${rawUrl}`)

    try {
      // Download the ZIP file
      const response = await axios({
        method: 'GET',
        url: rawUrl,
        responseType: 'stream'
      })

      const writer = createWriteStream(zipPath)
      await pipeline(response.data, writer)

      console.log(`Downloaded ZIP: ${skinInfo.skinName}`)

      // Extract the ZIP file
      await this.extractZip(zipPath, modPath)

      console.log(`Successfully extracted to: ${modPath}`)
      return skinInfo
    } catch (error) {
      console.error(`Failed to download/extract skin: ${error}`)
      throw new Error(
        `Failed to download skin: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async extractZip(zipPath: string, destPath: string): Promise<void> {
    try {
      await fs.mkdir(destPath, { recursive: true })

      const zip = new AdmZip(zipPath)
      zip.extractAllTo(destPath, true)

      console.log(`Extracted ${zipPath} to ${destPath}`)
    } catch (error) {
      console.error('Error extracting ZIP:', error)
      throw error
    }
  }

  private parseGitHubUrl(url: string): SkinInfo {
    // Example: https://github.com/darkseal-org/lol-skins/blob/main/skins/Aatrox/DRX%20Aatrox.zip
    const urlPattern =
      /github\.com\/darkseal-org\/lol-skins\/blob\/main\/skins\/([^\\/]+)\/([^\\/]+)$/
    const match = url.match(urlPattern)

    if (!match) {
      throw new Error(
        'Invalid GitHub URL format. Expected format: https://github.com/darkseal-org/lol-skins/blob/main/skins/[Champion]/[SkinName].zip'
      )
    }

    const championName = match[1]
    const skinName = decodeURIComponent(match[2])

    return {
      championName,
      skinName,
      url,
      source: 'repository' as const
    }
  }

  async listDownloadedSkins(): Promise<SkinInfo[]> {
    const skins: SkinInfo[] = []

    try {
      const modFolders = await fs.readdir(this.modsDir)

      for (const modFolder of modFolders) {
        const modPath = path.join(this.modsDir, modFolder)
        const stat = await fs.stat(modPath)

        if (stat.isDirectory()) {
          // Check if it's a valid mod (has META/info.json)
          try {
            const metaPath = path.join(modPath, 'META', 'info.json')
            await fs.access(metaPath)

            // Parse champion name and skin name from folder name
            const parts = modFolder.split('_')
            if (parts.length >= 2) {
              const championName = parts[0]
              const restOfName = parts.slice(1).join('_')

              // Check if this is a user mod by looking for [User] prefix or Custom champion
              const isUserMod = championName === 'Custom' || restOfName.includes('[User]')

              // For user mods, preserve the [User] prefix if it doesn't exist
              let skinName = restOfName
              if (isUserMod && !skinName.includes('[User]')) {
                skinName = '[User] ' + skinName
              }

              // Add appropriate extension if missing
              if (!skinName.match(/\.(zip|wad|fantome)$/)) {
                skinName += '.zip'
              }

              skins.push({
                championName,
                skinName,
                url: isUserMod
                  ? `file://imported`
                  : `https://github.com/darkseal-org/lol-skins/blob/main/skins/${championName}/${encodeURIComponent(skinName)}`,
                localPath: modPath,
                source: isUserMod ? 'user' : 'repository'
              })
            }
          } catch {
            // Not a valid mod, skip
          }
        }
      }
    } catch (error) {
      console.error('Error listing downloaded skins:', error)
    }

    return skins
  }

  async deleteSkin(championName: string, skinName: string): Promise<void> {
    // Delete the extracted mod folder
    const modName = skinName.replace('.zip', '')
    const modPath = path.join(this.modsDir, `${championName}_${modName}`)

    try {
      await fs.rm(modPath, { recursive: true, force: true })
    } catch (error) {
      console.error('Error deleting mod folder:', error)
    }

    // Also delete the cached ZIP file
    const zipPath = path.join(this.cacheDir, championName, skinName)
    try {
      await fs.unlink(zipPath)

      // Clean up empty champion directory
      const championDir = path.join(this.cacheDir, championName)
      const files = await fs.readdir(championDir)
      if (files.length === 0) {
        await fs.rmdir(championDir)
      }
    } catch {
      // File or directory doesn't exist
    }
  }
}
