import axios from 'axios'
import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'

// Per-form preview PNGs from the LeagueSkins repo, cached on disk so the picker
// stays reliable offline. Best-effort: a failed download falls back to the
// remote raw URL and never blocks/throws.

const cacheRoot = (): string => path.join(app.getPath('userData'), 'form-images')

// Derive {champId}/{formId} from a raw URL ending in .../{champId}/.../{formId}/{formId}.png
function localPathForUrl(url: string): string | null {
  const match = url.match(/\/(\d+)\/\d+\/(\d+)\/\2\.png$/) || url.match(/\/(\d+)\/(\d+)\/\2\.png$/)
  if (!match) return null
  return path.join(cacheRoot(), match[1], `${match[2]}.png`)
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

// Returns a data URL for the cached PNG, downloading it first if needed.
// On any failure returns the original remote URL so the <img> still loads.
async function resolveOne(url: string): Promise<string> {
  const dest = localPathForUrl(url)
  if (!dest) return url

  try {
    if (existsSync(dest)) {
      return toDataUrl(await fs.readFile(dest))
    }
  } catch {
    // Cached file unreadable — re-download below.
  }

  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: (s) => s === 200
    })
    const buffer = Buffer.from(res.data)
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, buffer)
    } catch {
      // Persisting failed — still serve the in-memory copy this call.
    }
    return toDataUrl(buffer)
  } catch {
    return url
  }
}

// Resolves a gearIndex→rawUrl map to a gearIndex→(dataUrl|rawUrl) map.
// Downloads run in parallel and are independently fault-tolerant.
export async function resolveFormImages(
  urls: Record<number, string>
): Promise<Record<number, string>> {
  const entries = Object.entries(urls)
  const resolved: Record<number, string> = {}
  await Promise.all(
    entries.map(async ([index, url]) => {
      resolved[Number(index)] = await resolveOne(url)
    })
  )
  return resolved
}
