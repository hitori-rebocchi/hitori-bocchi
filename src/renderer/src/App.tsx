import { useAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilterPanel } from './components/FilterPanel'
import { GridViewToggle } from './components/GridViewToggle'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import { ChampionDataUpdateDialog } from './components/ChampionDataUpdateDialog'
import { LocaleProvider } from './contexts/LocaleContextProvider'
import { useLocale } from './contexts/useLocale'
import {
  championSearchQueryAtom,
  filtersAtom,
  selectedChampionKeyAtom,
  showFavoritesOnlyAtom,
  skinSearchQueryAtom,
  viewModeAtom
} from './store/atoms'

interface Champion {
  id: number
  key: string
  name: string
  title: string
  image: string
  skins: Skin[]
  tags: string[]
}

interface Skin {
  id: string
  num: number
  name: string
  nameEn?: string
  chromas: boolean
}

interface ChampionData {
  version: string
  lastUpdated: string
  champions: Champion[]
}

interface DownloadedSkin {
  championName: string
  skinName: string
  url: string
  localPath?: string
}

function AppContent(): React.JSX.Element {
  const { t } = useTranslation()
  const { currentLanguage } = useLocale()
  const [gamePath, setGamePath] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [isPatcherRunning, setIsPatcherRunning] = useState<boolean>(false)

  // Champion browser states
  const [championData, setChampionData] = useState<ChampionData | null>(null)
  const [selectedChampion, setSelectedChampion] = useState<Champion | null>(null)
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(null)
  const [downloadedSkins, setDownloadedSkins] = useState<DownloadedSkin[]>([])
  const [selectedChromaId, setSelectedChromaId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [toolsExist, setToolsExist] = useState<boolean | null>(null)
  const [downloadingTools, setDownloadingTools] = useState<boolean>(false)
  const [toolsDownloadProgress, setToolsDownloadProgress] = useState<number>(0)
  const [showUpdateDialog, setShowUpdateDialog] = useState<boolean>(false)
  const [appVersion, setAppVersion] = useState<string>('')
  const [showChampionDataUpdate, setShowChampionDataUpdate] = useState<boolean>(false)
  const [isUpdatingChampionData, setIsUpdatingChampionData] = useState<boolean>(false)

  // Jotai atoms for persisted state
  const [championSearchQuery, setChampionSearchQuery] = useAtom(championSearchQueryAtom)
  const [skinSearchQuery, setSkinSearchQuery] = useAtom(skinSearchQueryAtom)
  const [showFavoritesOnly, setShowFavoritesOnly] = useAtom(showFavoritesOnlyAtom)
  const [viewMode, setViewMode] = useAtom(viewModeAtom)
  const [filters, setFilters] = useAtom(filtersAtom)
  const [selectedChampionKey, setSelectedChampionKey] = useAtom(selectedChampionKeyAtom)

  const loadChampionData = useCallback(
    async (preserveSelection = false) => {
      const result = await window.api.loadChampionData(currentLanguage)
      if (result.success && result.data) {
        setChampionData(result.data)

        // Try to restore selected champion from persisted key
        if (selectedChampionKey) {
          const champion = result.data.champions.find((c) => c.key === selectedChampionKey)
          if (champion) {
            setSelectedChampion(champion)
            return
          }
        }

        if (preserveSelection && selectedChampion) {
          // Try to preserve the current selection
          const sameChampion = result.data.champions.find((c) => c.key === selectedChampion.key)
          setSelectedChampion(sameChampion || result.data.champions[0])
          setSelectedChampionKey(sameChampion?.key || result.data.champions[0]?.key || null)
        } else if (!selectedChampion && result.data.champions.length > 0) {
          // Only select first champion if none is selected
          setSelectedChampion(result.data.champions[0])
          setSelectedChampionKey(result.data.champions[0].key)
        }

        return result.data
      }
      return null
    },
    [currentLanguage, selectedChampionKey, selectedChampion, setSelectedChampionKey]
  )

  const checkChampionDataUpdates = useCallback(async () => {
    try {
      const result = await window.api.checkChampionUpdates(currentLanguage)
      if (result.success && result.needsUpdate) {
        setShowChampionDataUpdate(true)
      }
    } catch (error) {
      console.error('Failed to check champion data updates:', error)
    }
  }, [currentLanguage])

  const detectGamePath = useCallback(async () => {
    const result = await window.api.detectGame()
    if (result.success && result.gamePath) {
      setGamePath(result.gamePath)
      setStatusMessage(t('status.gameDetected'))
    } else {
      setStatusMessage(t('status.gameNotFound'))
    }
  }, [t])

  // Load data on component mount
  useEffect(() => {
    const initializeApp = async () => {
      checkPatcherStatus()
      const data = await loadChampionData()
      detectGamePath()
      loadDownloadedSkins()
      loadFavorites()
      checkToolsExist()
      loadAppVersion()

      // Check for champion data updates after initial load
      if (data) {
        checkChampionDataUpdates()
      }
    }

    initializeApp()
  }, [detectGamePath, loadChampionData, checkChampionDataUpdates])

  useEffect(() => {
    checkForUpdates()
  }, [])

  // Clear search queries on mount
  useEffect(() => {
    setChampionSearchQuery('')
    setSkinSearchQuery('')
  }, [setChampionSearchQuery, setSkinSearchQuery])

  // Set up tools download progress listener
  useEffect(() => {
    window.api.onToolsDownloadProgress((progress) => {
      setToolsDownloadProgress(progress)
    })
  }, [])

  // Set up update event listeners
  useEffect(() => {
    window.api.onUpdateAvailable((info) => {
      console.log('Update available:', info)
      setShowUpdateDialog(true)
    })
  }, [])

  // Reload champion data when language changes
  useEffect(() => {
    if (championData) {
      loadChampionData(true) // preserve selection
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLanguage])

  const checkPatcherStatus = async () => {
    const isRunning = await window.api.isPatcherRunning()
    setIsPatcherRunning(isRunning)
  }

  const checkToolsExist = async () => {
    const exist = await window.api.checkToolsExist()
    setToolsExist(exist)
  }

  const checkForUpdates = async () => {
    try {
      const result = await window.api.checkForUpdates()
      // Only proceed if we're in production (result will be null in dev)
      if (result && result.success) {
        console.log('Update check completed')
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
    }
  }

  const loadAppVersion = async () => {
    try {
      const version = await window.api.getAppVersion()
      setAppVersion(version)
    } catch (error) {
      console.error('Failed to load app version:', error)
    }
  }

  const handleChampionDataUpdate = async () => {
    setIsUpdatingChampionData(true)
    try {
      await fetchChampionData()
      setShowChampionDataUpdate(false)
      // Reload the data after update
      await loadChampionData(true) // preserve selection
    } catch (error) {
      console.error('Failed to update champion data:', error)
    } finally {
      setIsUpdatingChampionData(false)
    }
  }

  const downloadTools = async () => {
    setDownloadingTools(true)
    setStatusMessage('Downloading cslol-tools')

    const result = await window.api.downloadTools()
    if (result.success) {
      setToolsExist(true)
      setStatusMessage('Tools downloaded successfully!')
    } else {
      setStatusMessage(`Failed to download tools: ${result.error}`)
    }

    setDownloadingTools(false)
    setToolsDownloadProgress(0)
  }

  const loadDownloadedSkins = async () => {
    const result = await window.api.listDownloadedSkins()
    if (result.success && result.skins) {
      setDownloadedSkins(result.skins)
    }
  }

  const loadFavorites = async () => {
    const result = await window.api.getFavorites()
    if (result.success && result.favorites) {
      const favoriteKeys = new Set(result.favorites.map((f) => `${f.championKey}_${f.skinId}`))
      setFavorites(favoriteKeys)
    }
  }

  const toggleFavorite = async (champion: Champion, skin: Skin) => {
    const key = `${champion.key}_${skin.id}`
    const isFav = favorites.has(key)

    if (isFav) {
      await window.api.removeFavorite(champion.key, skin.id)
      setFavorites((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    } else {
      await window.api.addFavorite(champion.key, skin.id, skin.name)
      setFavorites((prev) => new Set(prev).add(key))
    }
  }

  const fetchChampionData = async () => {
    setLoading(true)
    setStatusMessage(t('status.fetchingData'))

    const result = await window.api.fetchChampionData(currentLanguage)
    if (result.success) {
      setStatusMessage(t('status.dataFetched', { count: result.championCount }))
      await loadChampionData()
    } else {
      setStatusMessage(`${t('errors.generic')}: ${result.message}`)
    }

    setLoading(false)
  }

  const browseForGame = async () => {
    const result = await window.api.browseGameFolder()
    if (result.success && result.gamePath) {
      setGamePath(result.gamePath)
      setStatusMessage('Game path set successfully!')
    }
  }

  const handleSkinClick = async (champion: Champion, skin: Skin, chromaId?: string) => {
    if (!gamePath) {
      setStatusMessage('Please set game path first')
      return
    }

    setLoading(true)
    setSelectedSkinId(skin.id)
    setSelectedChromaId(chromaId || null)

    try {
      // Stop patcher if running
      if (isPatcherRunning) {
        setStatusMessage('Stopping current patcher')
        await window.api.stopPatcher()
        await new Promise((resolve) => setTimeout(resolve, 500)) // Small delay
      }

      // Check if skin/chroma is already downloaded
      let skinFileName: string
      let githubUrl: string
      const downloadName = (skin.nameEn || skin.name).replace(/:/g, '') // Use English name for download and remove colons

      if (chromaId) {
        // Handle chroma
        skinFileName = `${downloadName} ${chromaId}.zip`
        const isChromaDownloaded = downloadedSkins.some(
          (ds) => ds.championName === champion.key && ds.skinName === skinFileName
        )

        if (!isChromaDownloaded) {
          githubUrl = `https://github.com/darkseal-org/lol-skins/blob/main/skins/${champion.key}/chromas/${encodeURIComponent(downloadName)}/${encodeURIComponent(skinFileName)}`

          setStatusMessage(t('status.downloading', { name: `${skin.name} (Chroma)` }))

          const downloadResult = await window.api.downloadSkin(githubUrl)
          if (!downloadResult.success) {
            throw new Error(downloadResult.error || 'Failed to download chroma')
          }

          await loadDownloadedSkins()
        }
      } else {
        // Handle regular skin
        skinFileName = `${downloadName}.zip`
        const isSkinDownloaded = downloadedSkins.some(
          (ds) => ds.championName === champion.key && ds.skinName === skinFileName
        )

        if (!isSkinDownloaded) {
          githubUrl = `https://github.com/darkseal-org/lol-skins/blob/main/skins/${champion.key}/${encodeURIComponent(skinFileName)}`

          setStatusMessage(t('status.downloading', { name: skin.name }))

          const downloadResult = await window.api.downloadSkin(githubUrl)
          if (!downloadResult.success) {
            throw new Error(downloadResult.error || 'Failed to download skin')
          }

          await loadDownloadedSkins()
        }
      }

      // Generate skin key for the patcher
      const skinKey = `${champion.key}/${skinFileName}`

      setStatusMessage(t('status.applying', { name: skin.name }))

      // Run patcher with the selected skin
      const patcherResult = await window.api.runPatcher(gamePath, [skinKey])
      if (patcherResult.success) {
        setStatusMessage(t('status.applied', { name: skin.name }))
        setIsPatcherRunning(true)
      } else {
        throw new Error(patcherResult.message || 'Failed to apply skin')
      }
    } catch (error) {
      setStatusMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setSelectedSkinId(null)
      // setSelectedChromaId(null)
    }

    setLoading(false)
  }

  const stopPatcher = async () => {
    setLoading(true)
    setStatusMessage('Stopping patcher')

    const result = await window.api.stopPatcher()
    if (result.success) {
      setStatusMessage('Patcher stopped')
      setIsPatcherRunning(false)
      setSelectedSkinId(null)
      // setSelectedChromaId(null)
    }

    setLoading(false)
  }

  // Filter champions based on search
  const filteredChampions =
    championData?.champions.filter((champ) =>
      champ.name.toLowerCase().includes(championSearchQuery.toLowerCase())
    ) || []

  const isSearchingGlobally = skinSearchQuery.trim().length > 0

  // Get skin image URL
  const getSkinImageUrl = (champion: Champion, skinNum: number) => {
    const championKey = champion.key
    return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championKey}_${skinNum}.jpg`
  }

  // Get all unique champion tags
  const getAllChampionTags = () => {
    const tagSet = new Set<string>()
    championData?.champions.forEach((champ) => {
      champ.tags.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }

  // Apply filters and sorting
  const applyFiltersAndSort = (skins: Array<{ champion: Champion; skin: Skin }>) => {
    let filtered = [...skins]

    // Apply download status filter
    if (filters.downloadStatus !== 'all') {
      filtered = filtered.filter(({ champion, skin }) => {
        const skinFileName = `${skin.nameEn || skin.name}.zip`.replace(/:/g, '')
        const isDownloaded = downloadedSkins.some(
          (ds) => ds.championName === champion.key && ds.skinName === skinFileName
        )
        return filters.downloadStatus === 'downloaded' ? isDownloaded : !isDownloaded
      })
    }

    // Apply chroma filter
    if (filters.chromaStatus !== 'all') {
      filtered = filtered.filter(({ skin }) => {
        return filters.chromaStatus === 'has-chromas' ? skin.chromas : !skin.chromas
      })
    }

    // Apply champion tag filter
    if (filters.championTags.length > 0) {
      filtered = filtered.filter(({ champion }) => {
        return filters.championTags.some((tag) => champion.tags.includes(tag))
      })
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (filters.sortBy) {
        case 'name-asc':
          return a.skin.name.localeCompare(b.skin.name)
        case 'name-desc':
          return b.skin.name.localeCompare(a.skin.name)
        case 'skin-asc':
          return a.skin.num - b.skin.num
        case 'skin-desc':
          return b.skin.num - a.skin.num
        case 'champion':
          return (
            a.champion.name.localeCompare(b.champion.name) || a.skin.name.localeCompare(b.skin.name)
          )
        default:
          return 0
      }
    })

    return filtered
  }

  // Get filtered skins for display
  const getDisplaySkins = () => {
    if (!championData) return []

    const allSkins: Array<{ champion: Champion; skin: Skin }> = []

    if (isSearchingGlobally) {
      // Global search
      const searchLower = skinSearchQuery.toLowerCase()
      championData.champions.forEach((champion) => {
        champion.skins.forEach((skin) => {
          if (skin.num !== 0 && skin.name.toLowerCase().includes(searchLower)) {
            allSkins.push({ champion, skin })
          }
        })
      })
    } else if (selectedChampion) {
      // Selected champion skins
      selectedChampion.skins.forEach((skin) => {
        if (skin.num !== 0) {
          if (!showFavoritesOnly || favorites.has(`${selectedChampion.key}_${skin.id}`)) {
            allSkins.push({ champion: selectedChampion, skin })
          }
        }
      })
    }

    return applyFiltersAndSort(allSkins)
  }

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      downloadStatus: 'all',
      chromaStatus: 'all',
      championTags: [],
      sortBy: 'name-asc'
    })
  }

  // Calculate stats for filter panel
  const calculateStats = () => {
    let total = 0
    let downloaded = 0

    if (championData) {
      championData.champions.forEach((champion) => {
        champion.skins.forEach((skin) => {
          if (skin.num !== 0) {
            total++
            const skinFileName = `${skin.nameEn || skin.name}.zip`.replace(/:/g, '')
            if (
              downloadedSkins.some(
                (ds) => ds.championName === champion.key && ds.skinName === skinFileName
              )
            ) {
              downloaded++
            }
          }
        })
      })
    }

    return { total, downloaded }
  }

  return (
    <>
      <TitleBar appVersion={appVersion} />
      <UpdateDialog isOpen={showUpdateDialog} onClose={() => setShowUpdateDialog(false)} />
      <ChampionDataUpdateDialog
        isOpen={showChampionDataUpdate}
        onUpdate={handleChampionDataUpdate}
        onSkip={() => setShowChampionDataUpdate(false)}
        currentVersion={championData?.version}
        isUpdating={isUpdatingChampionData}
      />
      <div className="flex flex-col h-screen pt-10 bg-cream-300 dark:bg-charcoal-950 text-charcoal-950 dark:text-cream-50 overflow-hidden transition-colors duration-200">
        {toolsExist === false && (
          <div className="fixed inset-0 bg-charcoal-950 bg-opacity-50 dark:bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-white dark:bg-charcoal-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-xl dark:shadow-dark-xl animate-slide-down">
              <h3 className="text-xl font-bold mb-3 text-charcoal-900 dark:text-cream-50">
                {t('tools.required')}
              </h3>
              <p className="text-charcoal-600 dark:text-charcoal-300 mb-6 leading-relaxed">
                {t('tools.description')}
              </p>
              {downloadingTools ? (
                <div>
                  <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mb-3">
                    {t('tools.downloading', { progress: toolsDownloadProgress })}
                  </p>
                  <div className="w-full bg-charcoal-100 dark:bg-charcoal-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-terracotta-500 h-full transition-all duration-300 relative overflow-hidden"
                      style={{ width: `${toolsDownloadProgress}%` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-progress"></div>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full px-6 py-3 bg-terracotta-500 hover:bg-terracotta-600 text-white font-medium rounded-lg transition-all duration-200 shadow-soft hover:shadow-medium active:scale-[0.98]"
                  onClick={downloadTools}
                >
                  {t('tools.downloadTools')}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-8 py-5 bg-white dark:bg-charcoal-900 border-b-2 border-charcoal-200 dark:border-charcoal-800 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="text"
                value={gamePath}
                placeholder="Game path not set"
                readOnly
                className="flex-1 px-4 py-2.5 text-sm bg-cream-50 dark:bg-charcoal-800 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200 placeholder-charcoal-400 dark:placeholder-charcoal-500 focus:outline-none focus:ring-2 focus:ring-terracotta-500 focus:border-transparent transition-all duration-200"
              />
              <button
                className="px-4 py-2.5 text-sm bg-white dark:bg-charcoal-800 hover:bg-cream-100 dark:hover:bg-charcoal-700 text-charcoal-800 dark:text-charcoal-200 font-medium rounded-lg transition-all duration-200 border border-charcoal-200 dark:border-charcoal-700 hover:border-charcoal-300 dark:hover:border-charcoal-600 shadow-sm hover:shadow-md dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={browseForGame}
                disabled={loading}
              >
                {t('actions.browse')}
              </button>
            </div>
            <button
              className={`px-4 py-2.5 text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium
                ${
                  showFavoritesOnly
                    ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 border-2 border-red-200 dark:border-red-800'
                    : 'bg-white dark:bg-charcoal-800 text-charcoal-800 dark:text-charcoal-200 hover:bg-cream-100 dark:hover:bg-charcoal-700 border border-charcoal-200 dark:border-charcoal-700 shadow-sm hover:shadow-md dark:shadow-none'
                }`}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              disabled={loading}
            >
              <span className={showFavoritesOnly ? 'text-red-500' : ''}>❤️</span>{' '}
              {t('nav.favorites')}
            </button>
            {!championData && (
              <button
                className="px-5 py-2.5 text-sm bg-terracotta-500 hover:bg-terracotta-600 text-white font-medium rounded-lg transition-all duration-200 shadow-soft hover:shadow-medium dark:shadow-dark-soft disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                onClick={fetchChampionData}
                disabled={loading}
              >
                {t('champion.downloadData')}
              </button>
            )}
            {championData && (
              <button
                className="px-4 py-2.5 text-sm bg-white dark:bg-charcoal-800 hover:bg-cream-100 dark:hover:bg-charcoal-700 text-charcoal-800 dark:text-charcoal-200 font-medium rounded-lg transition-all duration-200 border border-charcoal-200 dark:border-charcoal-700 hover:border-charcoal-300 dark:hover:border-charcoal-600 shadow-sm hover:shadow-md dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={fetchChampionData}
                disabled={loading}
              >
                {t('champion.updateData')}
              </button>
            )}
            {isPatcherRunning && (
              <button
                className="px-4 py-2.5 text-sm bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-all duration-200 shadow-soft hover:shadow-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                onClick={stopPatcher}
                disabled={loading}
              >
                {t('actions.stop')} Patcher
              </button>
            )}
          </div>
        </div>

        {championData ? (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-80 bg-cream-50 dark:bg-charcoal-900 border-r-2 border-charcoal-200 dark:border-charcoal-800 flex flex-col shadow-md dark:shadow-none">
              <div className="p-6">
                <input
                  type="text"
                  placeholder="Search champions"
                  value={championSearchQuery}
                  onChange={(e) => setChampionSearchQuery(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm bg-cream-50 dark:bg-charcoal-800 border border-charcoal-200 dark:border-charcoal-700 rounded-lg text-charcoal-700 dark:text-charcoal-200 placeholder-charcoal-400 dark:placeholder-charcoal-500 focus:outline-none focus:ring-2 focus:ring-terracotta-500 focus:border-transparent transition-all duration-200"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredChampions.map((champion, index) => {
                  const showLetter =
                    index === 0 ||
                    filteredChampions[index - 1].name[0].toUpperCase() !==
                      champion.name[0].toUpperCase()

                  return (
                    <div key={champion.key}>
                      {showLetter && (
                        <div className="px-6 py-3 text-xs font-bold text-charcoal-700 dark:text-charcoal-400 uppercase tracking-wider">
                          {champion.name[0].toUpperCase()}
                        </div>
                      )}
                      <div
                        className={`flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-200 mx-3 my-1 rounded-lg border-2
                          ${
                            selectedChampion?.key === champion.key
                              ? 'bg-terracotta-500 text-white shadow-md dark:shadow-dark-soft border-terracotta-600 scale-[1.02]'
                              : 'hover:bg-cream-100 dark:hover:bg-charcoal-800 text-charcoal-800 dark:text-charcoal-200 border-transparent hover:border-charcoal-200 dark:hover:border-charcoal-700'
                          }`}
                        onClick={() => {
                          setSelectedChampion(champion)
                          setSelectedChampionKey(champion.key)
                        }}
                      >
                        <img
                          src={champion.image}
                          alt={champion.name}
                          className="w-10 h-10 rounded-lg"
                        />
                        <span className="text-sm font-medium">{champion.name}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {championData && (
                <div className="px-6 py-4 text-xs text-charcoal-500 dark:text-charcoal-500 border-t-2 border-charcoal-200 dark:border-charcoal-800 bg-cream-100 dark:bg-charcoal-950">
                  <div>Champion data: v{championData.version}</div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col bg-cream-200 dark:bg-charcoal-950 overflow-hidden">
              <FilterPanel
                filters={filters}
                onFiltersChange={setFilters}
                availableTags={getAllChampionTags()}
                downloadedCount={calculateStats().downloaded}
                totalCount={calculateStats().total}
                onClearFilters={clearFilters}
              />
              <div className="px-8 pt-6 pb-4 flex items-center justify-between gap-4">
                <input
                  type="text"
                  placeholder="Search skins across all champions..."
                  value={skinSearchQuery}
                  onChange={(e) => setSkinSearchQuery(e.target.value)}
                  className="flex-1 px-5 py-3 bg-white dark:bg-charcoal-800 border border-charcoal-200 dark:border-charcoal-700 rounded-xl text-charcoal-700 dark:text-charcoal-200 placeholder-charcoal-400 dark:placeholder-charcoal-500 focus:outline-none focus:ring-2 focus:ring-terracotta-500 focus:border-transparent transition-all duration-200 shadow-soft dark:shadow-none"
                />
                <GridViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
              </div>
              {(selectedChampion || isSearchingGlobally) && (
                <div className="flex-1 overflow-y-auto px-8 pb-8">
                  {getDisplaySkins().length > 0 ? (
                    <>
                      <div className="mb-4 text-sm text-charcoal-600 dark:text-charcoal-400">
                        Showing {getDisplaySkins().length} skin
                        {getDisplaySkins().length !== 1 ? 's' : ''}
                      </div>
                      <div
                        className={`
                    ${
                      viewMode === 'list'
                        ? 'space-y-2'
                        : `grid gap-6 ${
                            viewMode === 'compact'
                              ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10'
                              : viewMode === 'comfortable'
                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                          }`
                    }
                  `}
                      >
                        {getDisplaySkins().map(({ champion, skin }) => {
                          const skinFileName = `${skin.nameEn || skin.name}.zip`.replace(/:/g, '')
                          const isDownloaded = downloadedSkins.some(
                            (ds) => ds.championName === champion.key && ds.skinName === skinFileName
                          )
                          const isFavorite = favorites.has(`${champion.key}_${skin.id}`)

                          // List view
                          if (viewMode === 'list') {
                            return (
                              <div
                                key={`${champion.key}_${skin.id}`}
                                className={`flex items-center gap-4 p-3 bg-white dark:bg-charcoal-800 rounded-lg transition-all duration-200 cursor-pointer border
                              ${
                                selectedSkinId === skin.id && !selectedChromaId
                                  ? 'border-terracotta-500 bg-terracotta-50 dark:bg-terracotta-950/20'
                                  : 'border-charcoal-200 dark:border-charcoal-700 hover:border-charcoal-300 dark:hover:border-charcoal-600 hover:shadow-md dark:hover:shadow-dark-soft'
                              }`}
                                onClick={() => !loading && handleSkinClick(champion, skin)}
                              >
                                <img
                                  src={getSkinImageUrl(champion, skin.num)}
                                  alt={skin.name}
                                  className="w-16 h-16 object-cover rounded"
                                />
                                <div className="flex-1">
                                  <p className="font-medium text-charcoal-900 dark:text-charcoal-100">
                                    {skin.name}
                                  </p>
                                  <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
                                    {champion.name}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {skin.chromas && (
                                    <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded">
                                      Chromas
                                    </span>
                                  )}
                                  {isDownloaded && (
                                    <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
                                      <span className="text-white text-xs">↓</span>
                                    </span>
                                  )}
                                  <button
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                                  ${
                                    isFavorite
                                      ? 'bg-red-100 dark:bg-red-900/30 text-red-500'
                                      : 'bg-charcoal-100 dark:bg-charcoal-700 text-charcoal-400 hover:text-charcoal-600 dark:hover:text-charcoal-300'
                                  }`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleFavorite(champion, skin)
                                    }}
                                  >
                                    {isFavorite ? '❤️' : '🤍'}
                                  </button>
                                </div>
                              </div>
                            )
                          }

                          // Card views
                          return (
                            <div
                              key={`${champion.key}_${skin.id}`}
                              className={`group relative bg-cream-50 dark:bg-charcoal-800 rounded-xl overflow-hidden transform transition-all duration-300 ease-out border border-charcoal-200 dark:border-charcoal-700
                            ${
                              selectedSkinId === skin.id && !selectedChromaId
                                ? 'ring-2 ring-terracotta-500 shadow-xl dark:shadow-dark-large scale-[1.02] border-terracotta-500'
                                : 'hover:shadow-xl dark:hover:shadow-dark-large shadow-md dark:shadow-dark-soft hover:-translate-y-1 hover:scale-[1.02] hover:border-charcoal-300 dark:hover:border-charcoal-600'
                            } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                          `}
                            >
                              <div className="relative aspect-[0.67] overflow-hidden bg-charcoal-100 dark:bg-charcoal-900">
                                <img
                                  src={getSkinImageUrl(champion, skin.num)}
                                  alt={skin.name}
                                  className="w-full h-full object-cover"
                                  onClick={() => !loading && handleSkinClick(champion, skin)}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                                <div className="absolute top-2 left-2 px-2 py-1 bg-black bg-opacity-75 backdrop-blur-sm rounded-lg text-xs text-white font-medium transform transition-all duration-300 group-hover:scale-105">
                                  {champion.name}
                                </div>
                                {selectedSkinId === skin.id && !selectedChromaId && (
                                  <div className="absolute inset-0 bg-terracotta-500 bg-opacity-10 flex items-center justify-center">
                                    <div className="w-12 h-12 bg-terracotta-500 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg">
                                      ✓
                                    </div>
                                  </div>
                                )}
                                {isDownloaded && selectedSkinId !== skin.id && (
                                  <div
                                    className="absolute bottom-2 right-2 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center shadow-soft transform transition-all duration-300 group-hover:scale-110"
                                    title="Downloaded"
                                  >
                                    <span className="text-white text-xs">↓</span>
                                  </div>
                                )}
                                <button
                                  className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all
                                      ${
                                        isFavorite
                                          ? 'bg-white/10 backdrop-blur-sm text-red-500'
                                          : 'bg-white/10 backdrop-blur-sm text-white/70 hover:text-white hover:bg-white/20'
                                      }`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleFavorite(champion, skin)
                                  }}
                                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                                >
                                  {isFavorite ? '❤️' : '🤍'}
                                </button>
                              </div>
                              <div
                                className={`${viewMode === 'spacious' ? 'p-4' : viewMode === 'comfortable' ? 'p-3' : 'p-2'} bg-white dark:bg-charcoal-800`}
                              >
                                <p
                                  className={`${viewMode === 'spacious' ? 'text-base' : viewMode === 'comfortable' ? 'text-sm' : 'text-xs'} font-semibold text-charcoal-900 dark:text-charcoal-100 truncate`}
                                >
                                  {skin.name}
                                </p>
                                {viewMode === 'spacious' && (
                                  <div className="mt-2 flex items-center gap-2">
                                    {skin.chromas && (
                                      <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded">
                                        Chromas
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-cream-300 dark:bg-charcoal-800 rounded-full flex items-center justify-center mx-auto mb-4">
                          <svg
                            className="w-8 h-8 text-charcoal-600 dark:text-charcoal-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </div>
                        <p className="text-charcoal-600 dark:text-charcoal-400 mb-2">
                          No skins match your filters
                        </p>
                        <button
                          onClick={clearFilters}
                          className="text-sm text-terracotta-600 dark:text-terracotta-400 hover:text-terracotta-700 dark:hover:text-terracotta-300 font-medium"
                        >
                          Clear all filters
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="w-16 h-16 bg-cream-300 dark:bg-charcoal-800 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-charcoal-600 dark:text-charcoal-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p className="text-lg text-charcoal-600 dark:text-charcoal-300 mb-6">
                {t('champion.noData')}
              </p>
              <button
                className="px-6 py-3 bg-terracotta-500 hover:bg-terracotta-600 text-white font-medium rounded-lg transition-all duration-200 shadow-soft hover:shadow-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                onClick={fetchChampionData}
                disabled={loading}
              >
                {t('champion.downloadData')}
              </button>
            </div>
          </div>
        )}

        <div className="border-t-2 border-charcoal-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900 px-8 py-4 shadow-md dark:shadow-none">
          <div className="text-sm text-charcoal-800 dark:text-charcoal-300 font-medium flex items-center gap-3">
            {loading && (
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 bg-terracotta-500 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                ></div>
                <div
                  className="w-2 h-2 bg-terracotta-500 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                ></div>
                <div
                  className="w-2 h-2 bg-terracotta-500 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                ></div>
              </div>
            )}
            {statusMessage || t('app.ready')}
          </div>
        </div>
      </div>
    </>
  )
}

function App(): React.JSX.Element {
  return (
    <LocaleProvider>
      <AppContent />
    </LocaleProvider>
  )
}

export default App
