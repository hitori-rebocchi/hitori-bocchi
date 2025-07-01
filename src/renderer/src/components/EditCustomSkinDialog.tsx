import React, { useState, useEffect } from 'react'

interface EditCustomSkinDialogProps {
  isOpen: boolean
  currentName: string
  onClose: () => void
  onSave: (newName: string, newImagePath?: string) => void
}

export const EditCustomSkinDialog: React.FC<EditCustomSkinDialogProps> = ({
  isOpen,
  currentName,
  onClose,
  onSave
}) => {
  const [newName, setNewName] = useState(currentName)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedImageName, setSelectedImageName] = useState<string>('')

  useEffect(() => {
    setNewName(currentName)
    setSelectedImage(null)
    setSelectedImageName('')
  }, [currentName])

  const handleSelectImage = async () => {
    const result = await window.api.browseImageFile()
    if (result.success && result.filePath) {
      setSelectedImage(result.filePath)
      const fileName = result.filePath.split(/[\\/]/).pop() || ''
      setSelectedImageName(fileName)
    }
  }

  const handleSave = () => {
    if (newName.trim()) {
      onSave(newName.trim(), selectedImage || undefined)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-charcoal-800 rounded-lg shadow-xl p-6 w-96 max-w-[90vw]">
        <h2 className="text-xl font-bold text-charcoal-900 dark:text-charcoal-100 mb-4">
          Edit Custom Mod
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-300 mb-1">
              Mod Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-charcoal-300 dark:border-charcoal-600 rounded-md bg-white dark:bg-charcoal-700 text-charcoal-900 dark:text-charcoal-100 focus:outline-none focus:ring-2 focus:ring-terracotta-500"
              placeholder="Enter mod name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal-700 dark:text-charcoal-300 mb-1">
              Preview Image (Optional)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectImage}
                className="px-4 py-2 bg-charcoal-100 dark:bg-charcoal-700 hover:bg-charcoal-200 dark:hover:bg-charcoal-600 text-charcoal-700 dark:text-charcoal-300 rounded-md transition-colors text-sm"
              >
                Select Image
              </button>
              {selectedImageName && (
                <span className="text-sm text-charcoal-600 dark:text-charcoal-400 truncate">
                  {selectedImageName}
                </span>
              )}
            </div>
            {selectedImage && (
              <p className="text-xs text-charcoal-500 dark:text-charcoal-500 mt-1">
                New image selected
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-charcoal-600 dark:text-charcoal-400 hover:text-charcoal-800 dark:hover:text-charcoal-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!newName.trim()}
            className="px-4 py-2 bg-terracotta-500 hover:bg-terracotta-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
