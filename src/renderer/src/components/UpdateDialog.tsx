import { useState, useEffect } from 'react'
import { X, Download, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface UpdateDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function UpdateDialog({ isOpen, onClose }: UpdateDialogProps) {
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [changelog, setChangelog] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadUpdateInfo()
    }
  }, [isOpen])

  useEffect(() => {
    // Set up event listeners for updater events
    window.api.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(progress.percent)
    })

    window.api.onUpdateDownloaded(() => {
      setIsDownloading(false)
      setIsInstalling(true)
    })

    window.api.onUpdateError((error) => {
      setError(error)
      setIsDownloading(false)
    })
  }, [])

  const loadUpdateInfo = async () => {
    try {
      const info = await window.api.getUpdateInfo()
      setUpdateInfo(info)

      // Load changelog
      const changelogResult = await window.api.getUpdateChangelog()
      if (changelogResult.success && changelogResult.changelog) {
        setChangelog(changelogResult.changelog)
      }
    } catch (error) {
      console.error('Failed to load update info:', error)
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    try {
      await window.api.downloadUpdate()
    } catch {
      setError('Failed to download update')
      setIsDownloading(false)
    }
  }

  const handleInstall = () => {
    window.api.quitAndInstall()
  }

  if (!isOpen || !updateInfo) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm overflow-y-auto py-16 grid place-items-center">
      <div className="relative max-w-2xl w-full mx-4 bg-white dark:bg-charcoal-900 rounded-lg shadow-xl my-8">
        <div className="flex items-center justify-between p-6 border-b border-charcoal-200 dark:border-charcoal-700">
          <h2 className="text-xl font-semibold text-charcoal-900 dark:text-charcoal-100">
            Update Available
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-charcoal-100 dark:hover:bg-charcoal-800 transition-colors"
            disabled={isDownloading || isInstalling}
          >
            <X className="w-5 h-5 text-charcoal-500 dark:text-charcoal-400" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-5 h-5 text-blue-500" />
              <span className="text-lg font-medium text-charcoal-900 dark:text-charcoal-100">
                Version {updateInfo.version}
              </span>
            </div>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
              A new version of Bocchi is available for download.
            </p>
          </div>

          {changelog && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-charcoal-700 dark:text-charcoal-300 mb-3">
                What&apos;s New
              </h3>
              <div className="bg-charcoal-50 dark:bg-charcoal-800 rounded p-4 max-h-96 overflow-y-auto">
                <div
                  className="prose prose-sm dark:prose-invert max-w-none 
                  prose-headings:text-charcoal-900 dark:prose-headings:text-charcoal-100
                  prose-h1:text-2xl prose-h1:mb-4
                  prose-h2:text-xl prose-h2:mb-3 prose-h2:mt-6
                  prose-h3:text-lg prose-h3:mb-2 prose-h3:mt-4
                  prose-h4:text-base prose-h4:mb-2 prose-h4:mt-3
                  prose-p:text-charcoal-700 dark:prose-p:text-charcoal-300
                  prose-p:mb-3 prose-p:leading-relaxed
                  prose-ul:my-3 prose-ul:space-y-2
                  prose-li:text-charcoal-700 dark:prose-li:text-charcoal-300
                  prose-li:marker:text-terracotta-500 dark:prose-li:marker:text-terracotta-400
                  prose-strong:text-charcoal-900 dark:prose-strong:text-charcoal-100
                  prose-strong:font-semibold
                  prose-code:text-terracotta-600 dark:prose-code:text-terracotta-400
                  prose-code:bg-charcoal-100 dark:prose-code:bg-charcoal-900
                  prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                  prose-code:before:content-[''] prose-code:after:content-['']
                  prose-pre:bg-charcoal-900 dark:prose-pre:bg-charcoal-950
                  prose-pre:text-charcoal-100
                  prose-a:text-terracotta-600 dark:prose-a:text-terracotta-400
                  prose-a:no-underline hover:prose-a:underline"
                >
                  <ReactMarkdown>{changelog}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {isDownloading && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-charcoal-600 dark:text-charcoal-400">Downloading...</span>
                <span className="text-charcoal-900 dark:text-charcoal-100 font-medium">
                  {downloadProgress.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-charcoal-200 dark:bg-charcoal-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-charcoal-200 dark:border-charcoal-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-charcoal-700 dark:text-charcoal-300 hover:bg-charcoal-100 dark:hover:bg-charcoal-800 rounded transition-colors"
            disabled={isDownloading || isInstalling}
          >
            Later
          </button>
          {!isInstalling ? (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Downloading...' : 'Download Update'}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
            >
              Install and Restart
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
