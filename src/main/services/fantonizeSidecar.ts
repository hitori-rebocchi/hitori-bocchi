import { spawn } from 'child_process'
import { getSidecarPath } from '../utils/sidecarPath'

export interface GenerationItem {
  skinNumber: number
  fileLabel: string
  displayName: string
  // chroma parent slot; pets fall back to it when the chroma slot has no bin
  parentSkinNumber?: number
  // exalted form to bake (gear position; 0 = default). Omit for ordinary skins.
  gearIndex?: number
}

export interface GenerationRequest {
  wadPath: string
  champion: string
  items: GenerationItem[]
  outputDir: string
  author: string
  petNames?: string[]
}

interface RustGenerationResult {
  success: boolean
  skinNumber: number
  outputPath?: string
  sizeBytes?: number
  error?: string
  warnings?: string[]
}

export interface GenerationProgressEvent {
  current: number
  total: number
  skinNumber: number
  message: string
  success: boolean | null
  warnings?: string[]
}

export type GenerationProgressCallback = (e: GenerationProgressEvent) => void

export interface SkinForm {
  index: number
  // short token from the form's portrait icon ('' for the default form)
  label: string
}

/**
 * Enumerate the exalted in-game forms for a skin (gear upgrades on its bin).
 * Empty for ordinary skins. Cheap — the sidecar skips the hashtable load.
 */
export async function listSkinForms(request: {
  wadPath: string
  champion: string
  skinNumber: number
}): Promise<SkinForm[]> {
  const sidecar = getSidecarPath()
  return new Promise<SkinForm[]>((resolve, reject) => {
    const child = spawn(sidecar, ['list-forms', '--request-json', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`list-forms exited ${code}: ${stderr.trim() || '(no stderr)'}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        resolve(Array.isArray(parsed.forms) ? parsed.forms : [])
      } catch (e) {
        reject(new Error(`failed to parse list-forms output: ${e}\n${stdout}`))
      }
    })
    child.stdin.write(JSON.stringify(request))
    child.stdin.end()
  })
}

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
      if (stderr.trim()) {
        console.warn('[fantonize] stderr:', stderr.trim())
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
        if (r.warnings?.length) {
          console.warn(`[fantonize] skin ${r.skinNumber} warnings:`, r.warnings)
        }
        if (r.success && r.outputPath) {
          written.push(r.outputPath)
          onProgress?.({
            current: idx + 1,
            total,
            skinNumber: r.skinNumber,
            message: `${r.outputPath.split(/[\\/]/).pop()} (${r.sizeBytes} bytes)`,
            success: true,
            warnings: r.warnings
          })
        } else {
          onProgress?.({
            current: idx + 1,
            total,
            skinNumber: r.skinNumber,
            message: r.error ?? 'unknown error',
            success: false,
            warnings: r.warnings
          })
        }
      })
      resolve(written)
    })

    child.stdin.write(JSON.stringify(rustRequest))
    child.stdin.end()
  })
}
