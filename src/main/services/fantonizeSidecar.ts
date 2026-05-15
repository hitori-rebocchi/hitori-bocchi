import { spawn } from 'child_process'
import { getSidecarPath } from '../utils/sidecarPath'

export interface GenerationItem {
  skinNumber: number
  fileLabel: string
  displayName: string
}

export interface GenerationRequest {
  wadPath: string
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
  success: boolean | null
}

export type GenerationProgressCallback = (e: GenerationProgressEvent) => void

export async function generateFantomes(
  request: GenerationRequest,
  hashtablePath: string,
  onProgress?: GenerationProgressCallback
): Promise<string[]> {
  if (!request.outputDir || request.outputDir.trim().length === 0) {
    throw new Error('outputDir is required')
  }
  const sidecar = getSidecarPath()
  const total = request.items.length

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
