/**
 * Feature flags shared between main and renderer.
 *
 * LOCAL_FANTOME_ONLY_MODE — temporary. When true, the UI hides:
 *   • "Download all skins" bulk button (repo download)
 *   • "Import from URL" option in file-import dialog
 * Users can still: import .fantome / .zip files from disk, and generate
 * .fantome files from their local LoL WAD via GenerateLocalFantomesDialog.
 *
 * Lift this flag back to `false` once a curated repo source or a permission
 * model for URL imports is in place.
 */
export const LOCAL_FANTOME_ONLY_MODE = true
