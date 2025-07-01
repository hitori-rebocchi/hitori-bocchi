import React, { useState, useMemo } from 'react'

interface DownloadedSkinsDialogProps {
  isOpen: boolean
  onClose: () => void
  downloadedSkins: Array<{ championName: string; skinName: string; localPath?: string }>
  championData?: {
    champions: Array<{ key: string; name: string }>
  }
  onDeleteSkin: (championName: string, skinName: string) => Promise<void>
  onRefresh: () => Promise<void>
}

export const DownloadedSkinsDialog: React.FC<DownloadedSkinsDialogProps> = ({
  isOpen,
  onClose,
  downloadedSkins,
  championData,
  onDeleteSkin,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingSkins, setDeletingSkins] = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'repo' | 'custom'>('all')

  // Group skins by champion
  const groupedSkins = useMemo(() => {
    const groups: Record<
      string,
      Array<{ skinName: string; localPath?: string; isCustom: boolean }>
    > = {}

    downloadedSkins.forEach((skin) => {
      if (!groups[skin.championName]) {
        groups[skin.championName] = []
      }

      const isCustom = skin.championName === 'Custom' || skin.skinName.includes('[User]')

      // Filter by category
      if (selectedCategory === 'repo' && isCustom) return
      if (selectedCategory === 'custom' && !isCustom) return

      // Filter by search query
      const championDisplayName =
        championData?.champions.find((c) => c.key === skin.championName)?.name || skin.championName
      if (
        searchQuery &&
        !skin.skinName.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !championDisplayName.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return
      }

      groups[skin.championName].push({
        skinName: skin.skinName,
        localPath: skin.localPath,
        isCustom
      })
    })

    // Remove empty groups
    Object.keys(groups).forEach((key) => {
      if (groups[key].length === 0) {
        delete groups[key]
      }
    })

    return groups
  }, [downloadedSkins, championData, searchQuery, selectedCategory])

  const totalSkins = useMemo(() => {
    return Object.values(groupedSkins).reduce((acc, skins) => acc + skins.length, 0)
  }, [groupedSkins])

  const handleDeleteSkin = async (championName: string, skinName: string) => {
    const key = `${championName}_${skinName}`
    setDeletingSkins((prev) => new Set(prev).add(key))

    try {
      await onDeleteSkin(championName, skinName)
      await onRefresh()
    } finally {
      setDeletingSkins((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-charcoal-800 rounded-lg shadow-xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-charcoal-200 dark:border-charcoal-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-charcoal-900 dark:text-charcoal-100">
              Downloaded Skins ({totalSkins})
            </h2>
            <button
              onClick={onClose}
              className="text-charcoal-500 hover:text-charcoal-700 dark:text-charcoal-400 dark:hover:text-charcoal-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-terracotta-500 text-white'
                  : 'bg-charcoal-100 dark:bg-charcoal-700 text-charcoal-700 dark:text-charcoal-300 hover:bg-charcoal-200 dark:hover:bg-charcoal-600'
              }`}
            >
              All Skins
            </button>
            <button
              onClick={() => setSelectedCategory('repo')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedCategory === 'repo'
                  ? 'bg-terracotta-500 text-white'
                  : 'bg-charcoal-100 dark:bg-charcoal-700 text-charcoal-700 dark:text-charcoal-300 hover:bg-charcoal-200 dark:hover:bg-charcoal-600'
              }`}
            >
              Repository Skins
            </button>
            <button
              onClick={() => setSelectedCategory('custom')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedCategory === 'custom'
                  ? 'bg-terracotta-500 text-white'
                  : 'bg-charcoal-100 dark:bg-charcoal-700 text-charcoal-700 dark:text-charcoal-300 hover:bg-charcoal-200 dark:hover:bg-charcoal-600'
              }`}
            >
              Custom Imports
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by champion or skin name..."
            className="w-full px-4 py-2 border border-charcoal-300 dark:border-charcoal-600 rounded-md bg-white dark:bg-charcoal-700 text-charcoal-900 dark:text-charcoal-100 focus:outline-none focus:ring-2 focus:ring-terracotta-500"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {Object.keys(groupedSkins).length === 0 ? (
            <div className="text-center py-8 text-charcoal-500 dark:text-charcoal-400">
              No skins found
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedSkins)
                .sort(([a], [b]) => {
                  // Put Custom at the end
                  if (a === 'Custom') return 1
                  if (b === 'Custom') return -1

                  // Sort by champion display name
                  const nameA = championData?.champions.find((c) => c.key === a)?.name || a
                  const nameB = championData?.champions.find((c) => c.key === b)?.name || b
                  return nameA.localeCompare(nameB)
                })
                .map(([championKey, skins]) => {
                  const championName =
                    championData?.champions.find((c) => c.key === championKey)?.name || championKey

                  return (
                    <div
                      key={championKey}
                      className="border border-charcoal-200 dark:border-charcoal-700 rounded-lg overflow-hidden"
                    >
                      <div className="bg-charcoal-50 dark:bg-charcoal-900 px-4 py-2">
                        <h3 className="font-semibold text-charcoal-900 dark:text-charcoal-100">
                          {championName} ({skins.length})
                        </h3>
                      </div>
                      <div className="divide-y divide-charcoal-200 dark:divide-charcoal-700">
                        {skins.map((skin) => {
                          const key = `${championKey}_${skin.skinName}`
                          const isDeleting = deletingSkins.has(key)
                          const displayName = skin.skinName
                            .replace(/\[User\]\s*/, '')
                            .replace(/\.(zip|wad|fantome)$/, '')

                          return (
                            <div
                              key={skin.skinName}
                              className="px-4 py-3 flex items-center justify-between hover:bg-charcoal-50 dark:hover:bg-charcoal-700/50 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-charcoal-700 dark:text-charcoal-300">
                                  {displayName}
                                </span>
                                {skin.isCustom && (
                                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">
                                    {championKey === 'Custom' ? 'Custom' : 'User Import'}
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => handleDeleteSkin(championKey, skin.skinName)}
                                disabled={isDeleting}
                                className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded transition-colors flex items-center gap-1"
                              >
                                {isDeleting ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Deleting...
                                  </>
                                ) : (
                                  <>
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                    Delete
                                  </>
                                )}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-charcoal-200 dark:border-charcoal-700 flex justify-between items-center">
          <div className="text-sm text-charcoal-600 dark:text-charcoal-400">
            Total: {totalSkins} skins
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-charcoal-200 dark:bg-charcoal-700 hover:bg-charcoal-300 dark:hover:bg-charcoal-600 text-charcoal-700 dark:text-charcoal-300 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
