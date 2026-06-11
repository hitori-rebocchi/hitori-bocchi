import path from 'path'
import fs from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { app } from 'electron'
import { isPackagedApp } from '../utils/isPackagedApp'

// Locally bundled per-form preview PNGs. Layout (relative, committed):
//   resources/form-previews/manifest.json
//   resources/form-previews/{championId}/{skinNum}/{gearIndex}.png
// Each image is the gear's own in-game portrait icon (mSelfOnlyPortraitIcon),
// fetched from CommunityDragon — so it maps to gearIndex exactly. Generated
// offline by scripts/build-form-previews.ts.

type Manifest = Record<string, Record<string, Record<string, string>>>

let manifestCache: Manifest | null | undefined

// Root of the bundled form-previews dir, dev (repo root) and packaged
// (process.resourcesPath) alike. Mirrors getSidecarPath()'s dev/packaged split.
function previewRoot(): string {
  if (!isPackagedApp()) {
    return path.join(app.getAppPath(), 'resources', 'form-previews')
  }
  return path.join(process.resourcesPath, 'form-previews')
}

function loadManifest(): Manifest | null {
  if (manifestCache !== undefined) return manifestCache
  const manifestPath = path.join(previewRoot(), 'manifest.json')
  try {
    if (existsSync(manifestPath)) {
      manifestCache = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest
    } else {
      manifestCache = null
    }
  } catch {
    manifestCache = null
  }
  return manifestCache
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

// Reads a bundled PNG (path is manifest-relative to previewRoot) as a data URL.
async function readLocalPng(relPath: string): Promise<string | null> {
  try {
    const abs = path.join(previewRoot(), relPath)
    if (!existsSync(abs)) return null
    return toDataUrl(await fs.readFile(abs))
  } catch {
    return null
  }
}

// Resolves bundled gearIndex -> data-URL images for one skin from the manifest.
// Returns {} when nothing is bundled for this (championId, skinNum); the caller
// then falls back to the remote per-form URLs.
export async function getLocalFormImages(
  championId: number,
  skinNum: number
): Promise<Record<number, string>> {
  const manifest = loadManifest()
  if (!manifest) return {}
  const entries = manifest[String(championId)]?.[String(skinNum)]
  if (!entries) return {}

  const out: Record<number, string> = {}
  await Promise.all(
    Object.entries(entries).map(async ([gearIndex, relPath]) => {
      const dataUrl = await readLocalPng(relPath)
      if (dataUrl) out[Number(gearIndex)] = dataUrl
    })
  )
  return out
}

// True when at least one bundled image exists for this skin.
export function hasLocalFormImages(championId: number, skinNum: number): boolean {
  const manifest = loadManifest()
  return Boolean(manifest?.[String(championId)]?.[String(skinNum)])
}
