/**
 * Hashtable service for resolving WAD path hashes (XXH64) to filenames.
 *
 * The hashtable is a ~200MB text file (`<hex_hash> <path>` per line) maintained
 * by CommunityDragon (CDTB). We download it on first use and cache in userData,
 * then stream-parse on demand to extract only the hashes a caller needs.
 *
 * Sources are tried in order with retries. The primary single-file mirror sits
 * behind Cloudflare and intermittently 521s / drops the connection ("aborted"),
 * so we fall back to the GitHub-hosted split copy and ultimately let the user
 * place the file by hand.
 */

import { app } from 'electron'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'

/** Canonical single-file mirror maintained by CommunityDragon (Cloudflare-fronted). */
const CDRAGON_URL = 'https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt'
/** GitHub mirror: same data, split into hashes.game.txt.0, .1, … (GitHub size limit). */
const GITHUB_SPLIT_BASE = 'https://raw.githubusercontent.com/CommunityDragon/Data/master/hashes/lol'
/** Re-check upstream after this interval (24h). The file rolls with each LoL patch. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Per-source attempts before falling through to the next source. */
const DOWNLOAD_ATTEMPTS = 3
/** Base backoff between retries (grows linearly: 1s, 2s, …). */
const RETRY_BACKOFF_MS = 1000
/** Rough total for split-download progress (parts ≈ 205MB combined). */
const SPLIT_TOTAL_ESTIMATE = 210 * 1024 * 1024

const STREAM_OPTS = {
  responseType: 'stream' as const,
  timeout: 0,
  maxContentLength: Infinity,
  maxBodyLength: Infinity
}

export interface HashtableProgress {
  loaded: number
  total: number
  percent: number
}

/** Thrown when every source failed — callers surface a "their side, not ours" message. */
export class HashtableUnavailableError extends Error {
  constructor(public readonly attempts: string[]) {
    super(`Could not fetch the CommunityDragon hashtable from any source:\n${attempts.join('\n')}`)
    this.name = 'HashtableUnavailableError'
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Transient failures worth retrying: network resets, timeouts, 5xx, 429. 404 is not. */
function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; response?: { status?: number } }
  const status = e?.response?.status
  if (typeof status === 'number') return status >= 500 || status === 429
  const code = e?.code ?? ''
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true
  }
  const msg = (e?.message ?? '').toLowerCase()
  return msg.includes('aborted') || msg.includes('socket hang up') || msg.includes('timeout')
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

/** Stream a source into an open writer without closing it (so parts can append). */
function pumpInto(
  source: NodeJS.ReadableStream,
  writer: fs.WriteStream,
  onChunk: (bytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    source.on('data', (chunk: Buffer) => onChunk(chunk.length))
    source.on('error', reject)
    writer.on('error', reject)
    source.on('end', () => resolve())
    source.pipe(writer, { end: false })
  })
}

function finishWriter(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.on('error', reject)
    writer.end(() => resolve())
  })
}

async function downloadSingle(
  url: string,
  tmpPath: string,
  onProgress?: (p: HashtableProgress) => void
): Promise<number> {
  const response = await axios.get(url, STREAM_OPTS)
  const total = Number(response.headers['content-length'] ?? 0)
  const writer = fs.createWriteStream(tmpPath)
  let loaded = 0
  try {
    await pumpInto(response.data, writer, (n) => {
      loaded += n
      if (onProgress && total > 0) {
        onProgress({ loaded, total, percent: Math.round((loaded / total) * 100) })
      }
    })
  } catch (e) {
    writer.destroy()
    throw e
  }
  await finishWriter(writer)
  return loaded
}

/** Download `hashes.game.txt.0`, `.1`, … concatenating into one file until a 404. */
async function downloadSplit(
  baseUrl: string,
  tmpPath: string,
  onProgress?: (p: HashtableProgress) => void
): Promise<number> {
  const writer = fs.createWriteStream(tmpPath)
  let loaded = 0
  let part = 0
  let gotAny = false
  try {
    for (;;) {
      let response
      try {
        response = await axios.get(`${baseUrl}/hashes.game.txt.${part}`, STREAM_OPTS)
      } catch (e) {
        if (httpStatus(e) === 404 && gotAny) break
        throw e
      }
      gotAny = true
      await pumpInto(response.data, writer, (n) => {
        loaded += n
        if (onProgress) {
          onProgress({
            loaded,
            total: SPLIT_TOTAL_ESTIMATE,
            percent: Math.min(99, Math.round((loaded / SPLIT_TOTAL_ESTIMATE) * 100))
          })
        }
      })
      part++
    }
  } catch (e) {
    writer.destroy()
    throw e
  }
  if (!gotAny) {
    writer.destroy()
    throw new Error('mirror returned no hash parts')
  }
  await finishWriter(writer)
  return loaded
}

interface HashtableSource {
  name: string
  fetch: (tmpPath: string, onProgress?: (p: HashtableProgress) => void) => Promise<number>
}

const SOURCES: HashtableSource[] = [
  { name: 'CommunityDragon (raw)', fetch: (tmp, p) => downloadSingle(CDRAGON_URL, tmp, p) },
  {
    name: 'CommunityDragon/Data (GitHub mirror)',
    fetch: (tmp, p) => downloadSplit(GITHUB_SPLIT_BASE, tmp, p)
  }
]

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

  /** URL users can open to download the file by hand for manual placement. */
  getManualSourceUrl(): string {
    return CDRAGON_URL
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
   * REFRESH_INTERVAL_MS. A stale-refresh failure falls back to the cached file
   * instead of blocking the caller; a missing-file failure propagates as
   * HashtableUnavailableError. Returns the absolute path.
   */
  async ensure(onProgress?: (p: HashtableProgress) => void): Promise<string> {
    if (this.downloadInFlight) return this.downloadInFlight

    const meta = await this.readMeta()
    const fileExists = await this.exists()
    const stale = meta ? Date.now() - meta.fetchedAt > REFRESH_INTERVAL_MS : false
    if (fileExists && !stale) return this.filePath

    this.downloadInFlight = this.download(onProgress)
      .catch((e) => {
        if (fileExists) {
          console.warn(
            `[hashtable] refresh failed, using cached copy: ${e instanceof Error ? e.message : e}`
          )
          return this.filePath
        }
        throw e
      })
      .finally(() => {
        this.downloadInFlight = null
      })
    return this.downloadInFlight
  }

  private async download(onProgress?: (p: HashtableProgress) => void): Promise<string> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = this.filePath + '.partial'
    const attempts: string[] = []

    for (const source of SOURCES) {
      for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        try {
          const bytes = await source.fetch(tmp, onProgress)
          if (bytes <= 0) throw new Error('empty download')
          await fs.promises.rename(tmp, this.filePath)
          await this.writeMeta({ fetchedAt: Date.now(), bytes })
          return this.filePath
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          await this.safeUnlink(tmp)
          if (isRetryable(e) && attempt < DOWNLOAD_ATTEMPTS) {
            console.warn(`[hashtable] ${source.name} attempt ${attempt} failed: ${msg} — retrying`)
            await delay(RETRY_BACKOFF_MS * attempt)
            continue
          }
          attempts.push(`${source.name}: ${msg}`)
          break
        }
      }
    }
    throw new HashtableUnavailableError(attempts)
  }

  /**
   * Copy a user-provided hashtable file into place (manual fallback when both
   * download sources are blocked). Validates the first line looks like a hash row.
   */
  async importFromFile(srcPath: string): Promise<{ path: string; bytes: number }> {
    const stat = await fs.promises.stat(srcPath)
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('Selected file is empty or not a regular file')
    }
    await this.validateFormat(srcPath)
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.promises.copyFile(srcPath, this.filePath)
    await this.writeMeta({ fetchedAt: Date.now(), bytes: stat.size })
    return { path: this.filePath, bytes: stat.size }
  }

  /** Reject obviously-wrong files: the first non-empty line must be `<hex> <path>`. */
  private async validateFormat(srcPath: string): Promise<void> {
    const stream = fs.createReadStream(srcPath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let firstLine = ''
    for await (const line of rl) {
      if (line.trim().length > 0) {
        firstLine = line
        break
      }
    }
    rl.close()
    stream.close()
    if (!/^[0-9a-fA-F]{8,16}\s+\S/.test(firstLine)) {
      throw new Error(
        'File does not look like a CommunityDragon hashtable (expected "<hash> <path>" lines)'
      )
    }
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

  private async safeUnlink(p: string): Promise<void> {
    try {
      await fs.promises.unlink(p)
    } catch {
      /* already gone */
    }
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
