import fs from 'fs/promises'
import path from 'path'

export class ImageService {
  constructor() {
    // Service for loading custom skin images
  }

  async getCustomSkinImage(modPath: string): Promise<string | null> {
    try {
      const imageDir = path.join(modPath, 'IMAGE')

      // Check for various image formats
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']

      for (const ext of imageExtensions) {
        const imagePath = path.join(imageDir, `preview${ext}`)
        try {
          await fs.access(imagePath)
          // Convert to base64 data URL
          const imageBuffer = await fs.readFile(imagePath)
          const base64 = imageBuffer.toString('base64')
          const mimeType =
            ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.png'
                ? 'image/png'
                : 'image/webp'
          return `data:${mimeType};base64,${base64}`
        } catch {
          // Continue to next extension
        }
      }

      return null
    } catch {
      return null
    }
  }
}
