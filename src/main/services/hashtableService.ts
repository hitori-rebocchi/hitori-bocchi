/**
 * Hashtable service for resolving WAD path hashes (XXH64) to filenames.
 *
 * The hashtable is a ~200MB text file (`<hex_hash> <path>` per line) maintained
 * by CommunityDragon (CDTB). We download it on first use and cache in userData,
 * then stream-parse on demand to extract only the hashes a caller needs.
 */

import { app } from 'electron'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'

/** Canonical mirror maintained by CommunityDragon. */
const HASHTABLE_URL = 'https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt'
/** Re-check upstream after this interval (24h). The file rolls with each LoL patch. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface HashtableProgress {
  loaded: number
  total: number
  percent: number
}

class HashtableService {
  private filePath: string
  private metaPath: string
  private downloadInFlight: Promise<string> | null = null

  constructor() {
    const dir = path.join(app.getPath('userData'), 'hashtable')
    this.filePath = path.join(dir, 'hashes.game.txt')
    this.metaPath = path.join(dir, 'hashes.game.meta.json')
  }

  getFilePath(): string {
    return this.filePath
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(this.filePath)
      return stat.size > 0
    } catch {
      return false
    }
  }

  /**
   * Ensure a usable hashtable is on disk. Downloads if missing or older than
   * REFRESH_INTERVAL_MS. Returns the absolute path.
   */
  async ensure(onProgress?: (p: HashtableProgress) => void): Promise<string> {
    if (this.downloadInFlight) return this.downloadInFlight

    const meta = await this.readMeta()
    const fileExists = await this.exists()
    const stale = meta && Date.now() - meta.fetchedAt > REFRESH_INTERVAL_MS
    if (fileExists && !stale) return this.filePath

    this.downloadInFlight = this.download(onProgress).finally(() => {
      this.downloadInFlight = null
    })
    return this.downloadInFlight
  }

  private async download(onProgress?: (p: HashtableProgress) => void): Promise<string> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = this.filePath + '.partial'

    const response = await axios.get(HASHTABLE_URL, {
      responseType: 'stream',
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })

    const totalHeader = Number(response.headers['content-length'] ?? 0)
    let loaded = 0

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tmp)
      response.data.on('data', (chunk: Buffer) => {
        loaded += chunk.length
        if (onProgress && totalHeader > 0) {
          onProgress({
            loaded,
            total: totalHeader,
            percent: Math.round((loaded / totalHeader) * 100)
          })
        }
      })
      response.data.on('error', reject)
      writer.on('error', reject)
      writer.on('finish', () => resolve())
      response.data.pipe(writer)
    })

    await fs.promises.rename(tmp, this.filePath)
    await this.writeMeta({ fetchedAt: Date.now(), bytes: loaded })
    return this.filePath
  }

  /**
   * Stream-load the hashtable, returning only entries whose hash is in `needed`.
   * O(file_size + |needed|) memory, no full-table residency.
   */
  async load(needed: Set<bigint>): Promise<Map<bigint, string>> {
    const out = new Map<bigint, string>()
    if (needed.size === 0) return out

    const stream = fs.createReadStream(this.filePath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    const remaining = new Set(needed)
    for await (const rawLine of rl) {
      if (remaining.size === 0) break
      const sp = rawLine.indexOf(' ')
      if (sp < 0) continue
      const hex = rawLine.slice(0, sp)
      let h: bigint
      try {
        h = BigInt('0x' + hex)
      } catch {
        continue
      }
      if (remaining.has(h)) {
        out.set(h, rawLine.slice(sp + 1))
        remaining.delete(h)
      }
    }
    rl.close()
    stream.close()
    return out
  }

  private async readMeta(): Promise<{ fetchedAt: number; bytes: number } | null> {
    try {
      const txt = await fs.promises.readFile(this.metaPath, 'utf-8')
      return JSON.parse(txt)
    } catch {
      return null
    }
  }

  private async writeMeta(meta: { fetchedAt: number; bytes: number }): Promise<void> {
    await fs.promises.writeFile(this.metaPath, JSON.stringify(meta), 'utf-8')
  }
}

export const hashtableService = new HashtableService()
