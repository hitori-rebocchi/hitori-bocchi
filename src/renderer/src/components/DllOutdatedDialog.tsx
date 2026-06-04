import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface DllOutdatedDialogProps {
  isOpen: boolean
  onClose: () => void
  build: string | null
}

export function DllOutdatedDialog({ isOpen, onClose, build }: DllOutdatedDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            {t('dllEol.title')}
          </DialogTitle>
          <DialogDescription>{t('dllEol.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">{t('dllEol.waitForUpdate')}</p>
            </div>
          </div>

          {build && (
            <div className="bg-surface rounded-lg p-3 border border-border">
              <p className="text-xs text-text-muted">
                {t('dllEol.gameBuild')}{' '}
                <span className="font-mono text-text-secondary">{build}</span>
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t('dllEol.acknowledge')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
