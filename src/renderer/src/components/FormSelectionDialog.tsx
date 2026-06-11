import React from 'react'
import { Champion, Skin } from '../App'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { sanitizeSkinNameForPath } from '../../../shared/utils/skinFilename'

export interface SkinForm {
  index: number
  label: string
}

// Prettify a raw form token (e.g. 'ULT' → 'Ultimate', 'Form2' → 'Form 2').
function prettifyToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  if (trimmed.toUpperCase() === 'ULT') return 'Ultimate'
  // Insert a space before a trailing run of digits: 'Form2' → 'Form 2'.
  const spaced = trimmed
    .replace(/(\d+)$/, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
  // Title-case each word.
  return spaced
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

// Display name for a form: "Default" for index 0; the descriptive token alone
// when present (e.g. "Assassin"), else a plain "Form N". The token-only form
// avoids the misleading "Form N" gear-vs-label offset.
export function formDisplayName(form: SkinForm): string {
  const pretty = prettifyToken(form.label)
  if (pretty) return pretty
  if (form.index === 0) return 'Default' // TODO i18n
  return `Form ${form.index + 1}`
}

// Filesystem-safe label passed to the backend. Index prefix keeps it unique
// even when tokens collide (e.g. 'ULT' on forms 3 & 4).
export function formFileLabel(form: SkinForm): string {
  const base = `Form ${form.index + 1}`
  const pretty = prettifyToken(form.label)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
  if (!pretty || pretty.toLowerCase() === base.toLowerCase()) return base
  return `${base} ${pretty}`
}

interface FormSelectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  champion: Champion
  skin: Skin
  forms: SkinForm[]
  skinImageUrl: string
  // gearIndex → per-form preview image (cached data URL or remote raw URL).
  // Any form without an entry falls back to skinImageUrl.
  formImageUrls?: Record<number, string>
  downloadedSkins: Array<{ championName: string; skinName: string; localPath?: string }>
  // index 0 → (champion, skin, 0, undefined); index N>0 → (champion, skin, N, formLabel).
  onGenerateForm: (champion: Champion, skin: Skin, formIndex: number, formLabel?: string) => void
}

export const FormSelectionDialog: React.FC<FormSelectionDialogProps> = ({
  open,
  onOpenChange,
  champion,
  skin,
  forms,
  skinImageUrl,
  formImageUrls,
  downloadedSkins,
  onGenerateForm
}) => {
  // A form is on disk when a fantome named `{base}[ {formLabel}].fantome` exists.
  const isFormDownloaded = (form: SkinForm): boolean => {
    const bases = [skin.nameEn, skin.name]
      .filter((n): n is string => Boolean(n && n.trim()))
      .map((n) => sanitizeSkinNameForPath(n))
    const exts = ['fantome', 'zip', 'wad', 'wad.client']
    for (const base of bases) {
      const suffix = form.index === 0 ? base : `${base} ${formFileLabel(form)}`
      const userNames = new Set(exts.map((e) => `[User] ${suffix}.${e}`))
      const repoNames = new Set(exts.map((e) => `${suffix}.${e}`))
      if (
        downloadedSkins.some(
          (ds) =>
            ds.championName === champion.key &&
            (userNames.has(ds.skinName) || repoNames.has(ds.skinName))
        )
      ) {
        return true
      }
    }
    return false
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          {/* TODO i18n */}
          <DialogTitle>Select a form for {skin.name}</DialogTitle>
          {/* TODO i18n */}
          <DialogDescription>Choose from {forms.length} available forms</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2">
          <div className="space-y-2 p-1">
            {forms.map((form) => {
              const isDownloaded = isFormDownloaded(form)

              return (
                <div
                  key={form.index}
                  className="relative flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all overflow-hidden bg-surface border-2 border-border hover:border-primary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800"
                  onClick={() => {
                    if (form.index === 0) {
                      onGenerateForm(champion, skin, 0, undefined)
                    } else {
                      onGenerateForm(champion, skin, form.index, formFileLabel(form))
                    }
                    onOpenChange(false)
                  }}
                >
                  <img
                    src={formImageUrls?.[form.index] || skinImageUrl}
                    alt={skin.name}
                    className="w-16 h-16 rounded-lg object-cover ml-2"
                    loading="lazy"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">{formDisplayName(form)}</p>
                  </div>
                  {isDownloaded && (
                    <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                      <span className="text-white text-xs">↓</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
