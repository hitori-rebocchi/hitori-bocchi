import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, Loader2, X, Image } from 'lucide-react'
import type { Champion } from '../App'

interface FileUploadButtonProps {
  champions: Champion[]
  onSkinImported: () => void
}

export const FileUploadButton: React.FC<FileUploadButtonProps> = ({
  champions,
  onSkinImported
}) => {
  const { t } = useTranslation()
  const [isImporting, setIsImporting] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [selectedChampion, setSelectedChampion] = useState<string>('')
  const [customName, setCustomName] = useState<string>('')
  const [selectedImage, setSelectedImage] = useState<string>('')
  const [error, setError] = useState<string>('')

  const handleBrowseFile = async () => {
    const result = await window.api.browseSkinFile()
    if (result.success && result.filePath) {
      setSelectedFile(result.filePath)

      // Try to extract champion name from file path
      const fileName = result.filePath.split(/[\\/]/).pop() || ''
      const match = fileName.match(/^([A-Za-z]+)[-_\s]/i)
      if (match && champions.find((c) => c.key === match[1])) {
        setSelectedChampion(match[1])
      }

      setError('')
      setShowDialog(true)
    }
  }

  const handleImport = async () => {
    if (!selectedFile) {
      setError(t('fileUpload.noFileSelected'))
      return
    }

    setError('')
    setIsImporting(true)

    try {
      // Validate file first
      const validation = await window.api.validateSkinFile(selectedFile)
      if (!validation.valid) {
        setError(validation.error || t('fileUpload.invalidFile'))
        setIsImporting(false)
        return
      }

      // Import the file
      const result = await window.api.importSkinFile(selectedFile, {
        championName: selectedChampion, // Pass empty string as-is, don't convert to undefined
        skinName: customName || undefined,
        imagePath: selectedImage || undefined
      })

      if (result.success) {
        setShowDialog(false)
        onSkinImported()
        // Reset form
        setSelectedFile('')
        setSelectedChampion('')
        setCustomName('')
        setSelectedImage('')
      } else {
        setError(result.error || t('fileUpload.importFailed'))
      }
    } catch {
      setError(t('fileUpload.importFailed'))
    } finally {
      setIsImporting(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      setSelectedFile(files[0].path)
      setShowDialog(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const closeDialog = () => {
    if (!isImporting) {
      setShowDialog(false)
      setError('')
      setSelectedFile('')
      setSelectedChampion('')
      setCustomName('')
      setSelectedImage('')
    }
  }

  return (
    <>
      <div onDrop={handleDrop} onDragOver={handleDragOver} className="inline-block">
        <button
          onClick={handleBrowseFile}
          className="px-4 py-2.5 text-sm bg-white dark:bg-charcoal-800 hover:bg-cream-100 dark:hover:bg-charcoal-700 text-charcoal-800 dark:text-charcoal-200 font-medium rounded-lg transition-all duration-200 border border-charcoal-200 dark:border-charcoal-700 hover:border-charcoal-300 dark:hover:border-charcoal-600 shadow-sm hover:shadow-md dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          disabled={isImporting}
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {t('fileUpload.uploadButton')}
        </button>
      </div>

      {showDialog && (
        <div className="fixed inset-0 bg-charcoal-950 bg-opacity-50 dark:bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white dark:bg-charcoal-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl dark:shadow-dark-xl animate-slide-down">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-charcoal-900 dark:text-cream-50">
                {t('fileUpload.importTitle')}
              </h3>
              <button
                onClick={closeDialog}
                disabled={isImporting}
                className="p-1 hover:bg-charcoal-100 dark:hover:bg-charcoal-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5 text-charcoal-600 dark:text-charcoal-400" />
              </button>
            </div>

            <p className="text-charcoal-600 dark:text-charcoal-300 mb-6 text-sm">
              {t('fileUpload.importDescription')}
            </p>

            {error && (
              <div className="mb-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-200 mb-1">
                  {t('fileUpload.selectedFile')}
                </label>
                <input
                  type="text"
                  value={selectedFile.split(/[\\/]/).pop() || ''}
                  disabled
                  className="w-full px-3 py-2 text-sm bg-cream-50 dark:bg-charcoal-900 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-200 mb-1">
                  {t('fileUpload.selectChampion')}{' '}
                  <span className="text-charcoal-500 dark:text-charcoal-400 font-normal">
                    (Optional)
                  </span>
                </label>
                <select
                  value={selectedChampion}
                  onChange={(e) => setSelectedChampion(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-cream-50 dark:bg-charcoal-900 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200 focus:outline-none focus:ring-2 focus:ring-terracotta-500 focus:border-transparent"
                >
                  <option value="">{t('fileUpload.championPlaceholder')}</option>
                  {champions.map((champion) => (
                    <option key={champion.key} value={champion.key}>
                      {champion.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-200 mb-1">
                  {t('fileUpload.customName')}{' '}
                  <span className="text-charcoal-500 dark:text-charcoal-400 font-normal">
                    (Optional)
                  </span>
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={t('fileUpload.customNamePlaceholder')}
                  className="w-full px-3 py-2 text-sm bg-cream-50 dark:bg-charcoal-900 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200 placeholder-charcoal-400 dark:placeholder-charcoal-500 focus:outline-none focus:ring-2 focus:ring-terracotta-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-200 mb-1">
                  {t('fileUpload.previewImage')}{' '}
                  <span className="text-charcoal-500 dark:text-charcoal-400 font-normal">
                    (Optional)
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedImage.split(/[\\/]/).pop() || ''}
                    disabled
                    placeholder={t('fileUpload.noImageSelected')}
                    className="flex-1 px-3 py-2 text-sm bg-cream-50 dark:bg-charcoal-900 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200 placeholder-charcoal-400 dark:placeholder-charcoal-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await window.api.browseImageFile()
                      if (result.success && result.filePath) {
                        setSelectedImage(result.filePath)
                      }
                    }}
                    className="px-4 py-2 text-sm bg-white dark:bg-charcoal-700 hover:bg-cream-100 dark:hover:bg-charcoal-600 text-charcoal-800 dark:text-charcoal-200 font-medium rounded-lg transition-all duration-200 border border-charcoal-200 dark:border-charcoal-600 flex items-center gap-2"
                  >
                    <Image className="h-4 w-4" />
                    {t('fileUpload.browseImage')}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeDialog}
                disabled={isImporting}
                className="px-4 py-2 text-sm bg-white dark:bg-charcoal-700 hover:bg-cream-100 dark:hover:bg-charcoal-600 text-charcoal-800 dark:text-charcoal-200 font-medium rounded-lg transition-all duration-200 border border-charcoal-200 dark:border-charcoal-600 disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting || !selectedFile}
                className="px-4 py-2 text-sm bg-terracotta-500 hover:bg-terracotta-600 text-white font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('fileUpload.importing')}
                  </>
                ) : (
                  t('fileUpload.import')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
