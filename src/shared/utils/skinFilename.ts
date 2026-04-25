export interface SkinNameInfo {
  nameEn?: string
  name: string
  chromaId?: string
  variantId?: string
}

/**
 * Sanitizes a string for use as a filesystem name on Windows.
 * Replaces characters that are illegal in Windows filenames with a space,
 * then collapses multiple spaces into one. Used for arbitrary user-facing
 * filenames (preset exports, champion folders) where space-replacement is
 * preferable to deletion.
 */
export function sanitizeFsName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Canonical sanitizer for ddragon skin names used as a path segment in either
 * a GitHub URL or an on-disk filename. Drops chars that cannot appear in
 * folder names (slashes, colons) instead of replacing them with a space, which
 * mirrors how community LeagueSkins forks name their folders ("K/DA" → "KDA",
 * "PROJECT: Yi" → "PROJECT Yi"). Year/variant parens stay intact.
 *
 * MUST be used everywhere a skin name is materialized — URL builder, on-disk
 * filename, and the renderer's "is downloaded" lookup — so the three forms
 * agree byte-for-byte.
 */
export function sanitizeSkinNameForPath(name: string): string {
  return name
    .replace(/[/\\:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Generates a consistent filename for a skin or chroma
 * This function ensures the same filename is generated whether downloading or checking status
 */
export function generateSkinFilename(skin: SkinNameInfo): string {
  // Use the same priority order as the download logic
  const baseName = sanitizeSkinNameForPath(skin.nameEn || skin.name)

  if (skin.chromaId) {
    return `${baseName} ${skin.chromaId}.zip`
  }

  if (skin.variantId) {
    return `${baseName} (${skin.variantId}).zip`
  }

  return `${baseName}.zip`
}

/**
 * Extracts the base skin name without file extension or chroma ID
 */
export function extractBaseSkinName(filename: string): string {
  // Remove .zip extension
  let baseName = filename.replace(/\.zip$/i, '')

  // Remove chroma ID (numbers at the end after a space)
  baseName = baseName.replace(/\s+\d+$/, '')

  // Remove variant ID (text in parentheses at the end)
  baseName = baseName.replace(/\s+\([^)]+\)$/, '')

  return baseName
}

/**
 * Checks if two filenames represent the same skin (ignoring chroma variations)
 */
export function isSameSkin(filename1: string, filename2: string): boolean {
  return extractBaseSkinName(filename1) === extractBaseSkinName(filename2)
}

/**
 * Normalizes a skin name for comparison (removes special chars, lowercases)
 */
export function normalizeSkinName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}
