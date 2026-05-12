/**
 * Thin TS wrapper around the `bocchi-overlay fantonize` subcommand.
 *
 * Spawns the native sidecar, pipes the request JSON on stdin, reads the JSON
 * result array on stdout. The algorithm itself lives in Rust (native/bocchi-overlay/).
 */
import { spawn } from 'child_process'
import { getBocchiOverlayPath } from '../utils/sidecarPath'

export interface GenerationItem {
  skinNumber: number
  /** Filename (no extension), e.g. "Akali_Star Guardian Akali" */
  fileLabel: string
  /** Display name for META/info.json, e.g. "Star Guardian Akali" */
  displayName: string
}

export interface GenerationRequest {
  wadPath: string
  /** Display-case champion name (e.g. "Akali"). */
  champion: string
  items: GenerationItem[]
  outputDir: string
  author: string
}

interface RustGenerationResult {
  success: boolean
  skinNumber: number
  outputPath?: string
  sizeBytes?: number
  error?: string
}

export interface GenerationProgressEvent {
  current: number
  total: number
  skinNumber: number
  message: string
  /** null = in progress, true = success, false = error */
  success: boolean | null
}

export type GenerationProgressCallback = (e: GenerationProgressEvent) => void

/**
 * Generate one .fantome per item via the native sidecar.
 * Returns the list of created file paths (failures are logged but not thrown).
 *
 * Progress events are best-effort: the sidecar generates all items in one
 * shot, so per-item progress fires when results come back (not while building).
 */
export async function generateFantomes(
  request: GenerationRequest,
  hashtablePath: string,
  onProgress?: GenerationProgressCallback
): Promise<string[]> {
  if (!request.outputDir || request.outputDir.trim().length === 0) {
    throw new Error('outputDir is required')
  }
  const sidecar = getBocchiOverlayPath()
  const total = request.items.length

  // Emit a "starting" event for each item so the UI knows the queue.
  if (onProgress) {
    for (let i = 0; i < total; i++) {
      onProgress({
        current: i + 1,
        total,
        skinNumber: request.items[i].skinNumber,
        message: `Building ${request.items[i].fileLabel}…`,
        success: null
      })
    }
  }

  const rustRequest = { ...request, hashtablePath }

  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(sidecar, ['fantonize', '--request-json', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`bocchi-overlay fantonize exited ${code}: ${stderr.trim() || '(no stderr)'}`)
        )
        return
      }
      let results: RustGenerationResult[]
      try {
        results = JSON.parse(stdout.trim())
      } catch (e) {
        reject(
          new Error(
            `failed to parse sidecar output: ${e}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
          )
        )
        return
      }
      const written: string[] = []
      results.forEach((r, idx) => {
        if (r.success && r.outputPath) {
          written.push(r.outputPath)
          onProgress?.({
            current: idx + 1,
            total,
            skinNumber: r.skinNumber,
            message: `${r.outputPath.split(/[\\/]/).pop()} (${r.sizeBytes} bytes)`,
            success: true
          })
        } else {
          onProgress?.({
            current: idx + 1,
            total,
            skinNumber: r.skinNumber,
            message: r.error ?? 'unknown error',
            success: false
          })
        }
      })
      resolve(written)
    })

    child.stdin.write(JSON.stringify(rustRequest))
    child.stdin.end()
  })
}
