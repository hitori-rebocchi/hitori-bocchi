import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

// Native window.confirm()/alert() freeze frameless Electron windows (the window
// stops responding to mouse input after the dialog closes). This is a custom
// React replacement driven imperatively via confirmDialog().

type Resolver = (value: boolean) => void
let trigger: ((message: string) => Promise<boolean>) | null = null

export function confirmDialog(message: string): Promise<boolean> {
  if (trigger) return trigger(message)
  // Fallback before the host mounts — shouldn't happen in practice.
  return Promise.resolve(window.confirm(message))
}

export function ConfirmHost(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = useState<{ message: string; resolve: Resolver } | null>(null)

  useEffect(() => {
    trigger = (message) => new Promise<boolean>((resolve) => setState({ message, resolve }))
    return () => {
      trigger = null
    }
  }, [])

  if (!state) return null

  const close = (value: boolean): void => {
    state.resolve(value)
    setState(null)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('common.confirm', 'Confirm')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary whitespace-pre-line py-2">{state.message}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={() => close(true)}>
            {t('common.ok', 'OK')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
