import { useState, useEffect } from 'react'
import { X, Download, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface UpdateDialogMockProps {
  isOpen: boolean
  onClose: () => void
}

export function UpdateDialogMock({ isOpen, onClose }: UpdateDialogMockProps) {
  // Mock data
  const mockUpdateInfo = {
    version: '1.2.0'
  }

  const mockChangelog = `## Version 1.2.0

### 🎉 New Features
- **Preset Manager**: Save and load your favorite skin combinations
- **Batch Operations**: Apply multiple skins at once
- **Performance Mode**: Optimized loading for slower systems

### 🐛 Bug Fixes
- Fixed crash when applying skins with special characters
- Resolved memory leak in skin preview
- Fixed dark mode issues in settings panel

### 🔧 Improvements
- Faster skin loading (up to 50% improvement)
- Better error messages
- Updated to latest cslol-tools
- Reduced application size by 20MB

### 📝 Notes
- This update includes breaking changes to the preset format
- Old presets will be automatically migrated
- Please report any issues on GitHub`

  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Simulate download progress
  useEffect(() => {
    if (isDownloading && downloadProgress < 100) {
      const timer = setTimeout(() => {
        setDownloadProgress((prev) => {
          const next = prev + Math.random() * 10
          if (next >= 100) {
            setIsDownloading(false)
            setIsInstalling(true)
            return 100
          }
          return next
        })
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [isDownloading, downloadProgress])

  const handleDownload = () => {
    setIsDownloading(true)
    setError(null)
    setDownloadProgress(0)
  }

  const handleInstall = () => {
    console.log('Installing update...')
    onClose()
  }

  if (!isOpen) return null

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
                Version {mockUpdateInfo.version}
              </span>
            </div>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
              A new version of Bocchi is available for download.
            </p>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-charcoal-700 dark:text-charcoal-300 mb-3">
              What&apos;s New
            </h3>
            <div className="bg-charcoal-50 dark:bg-charcoal-800 rounded p-4 prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{mockChangelog}</ReactMarkdown>
            </div>
          </div>

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
