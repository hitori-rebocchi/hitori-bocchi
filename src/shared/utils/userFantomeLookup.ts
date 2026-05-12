import { sanitizeSkinNameForPath } from './skinFilename'

/**
 * Names a locally-generated fantome can appear under in skinDownloader's
 * `[User] {name}.{ext}` listing. Both the EN and localized skin names show up
 * because handleGenerateLocal used to write the localized form before the
 * 2026-05-12 fix that pinned generation to `nameEn || name`. We keep both in
 * the candidate set so users who generated fantomes in a non-English UI still
 * have them resolve on apply.
 *
 * `skinFile` is the patcher's `{sanitized name}[ {chromaId}].zip` form (the
 * EN one). `skinCtx` (when available) carries the original SelectedSkin from
 * the renderer, which has both `skinName` (localized) and `skinNameEn`.
 */
export interface SkinContextLike {
  skinName?: string
  skinNameEn?: string
  chromaId?: string
}

const EXTS = ['fantome', 'zip', 'wad', 'wad.client'] as const

export function buildUserFantomeCandidates(
  skinFile: string,
  skinCtx?: SkinContextLike
): Set<string> {
  const out = new Set<string>()

  const baseFromFile = skinFile.replace(/\.(zip|fantome|wad\.client|wad)$/i, '')
  const sanitizedFromFile = sanitizeSkinNameForPath(baseFromFile)

  out.add(skinFile)
  out.add(`${sanitizedFromFile}.zip`)
  out.add(`${sanitizedFromFile}.fantome`)

  // Bases to materialize as `[User] {base}.{ext}`. Includes both the EN form
  // (already in skinFile) and, if we have a SelectedSkin, the localized form.
  const bases = new Set<string>([baseFromFile, sanitizedFromFile])
  if (skinCtx) {
    const localized = skinCtx.skinName
    if (localized && localized.trim()) {
      const locSan = sanitizeSkinNameForPath(localized)
      const suffix = skinCtx.chromaId ? ` ${skinCtx.chromaId}` : ''
      bases.add(`${locSan}${suffix}`)
    }
    const en = skinCtx.skinNameEn
    if (en && en.trim()) {
      const enSan = sanitizeSkinNameForPath(en)
      const suffix = skinCtx.chromaId ? ` ${skinCtx.chromaId}` : ''
      bases.add(`${enSan}${suffix}`)
    }
  }

  for (const base of bases) {
    for (const ext of EXTS) {
      out.add(`[User] ${base}.${ext}`)
    }
  }

  return out
}
