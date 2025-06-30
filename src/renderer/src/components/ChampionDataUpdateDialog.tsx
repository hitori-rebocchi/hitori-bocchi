import { RefreshCw } from 'lucide-react'

interface ChampionDataUpdateDialogProps {
  isOpen: boolean
  onUpdate: () => void
  onSkip: () => void
  currentVersion?: string
  isUpdating?: boolean
}

export function ChampionDataUpdateDialog({
  isOpen,
  onUpdate,
  onSkip,
  currentVersion,
  isUpdating = false
}: ChampionDataUpdateDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="relative max-w-md w-full mx-4 bg-white dark:bg-charcoal-900 rounded-lg shadow-xl">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-charcoal-900 dark:text-charcoal-100">
              Champion Data Update Available
            </h2>
          </div>

          <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mb-6">
            A new version of champion data is available. This update includes the latest champions,
            skins, and other game content.
            {currentVersion && (
              <span className="block mt-2 text-xs">Current version: {currentVersion}</span>
            )}
          </p>

          <div className="flex gap-3">
            <button
              onClick={onSkip}
              disabled={isUpdating}
              className="flex-1 px-4 py-2 text-sm font-medium text-charcoal-700 dark:text-charcoal-300 hover:bg-charcoal-100 dark:hover:bg-charcoal-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip for now
            </button>
            <button
              onClick={onUpdate}
              disabled={isUpdating}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded transition-colors flex items-center justify-center gap-2"
            >
              {isUpdating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Now'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
