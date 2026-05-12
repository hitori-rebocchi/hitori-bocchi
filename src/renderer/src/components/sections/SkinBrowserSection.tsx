import { useAtom, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import AutoSizer from 'react-virtualized-auto-sizer'
import { VirtualizedSkinGrid } from '../VirtualizedSkinGrid'
import { FilterPanel } from '../FilterPanel'
import { GridViewToggle } from '../GridViewToggle'
import { FileUploadButton } from '../FileUploadButton'
import { LOCAL_FANTOME_ONLY_MODE } from '../../../../shared/constants/features'
import { filtersAtom, skinSearchQueryAtom, viewModeAtom } from '../../store/atoms'
import { showDownloadedSkinsDialogAtom } from '../../store/atoms/ui.atoms'
import {
  useDisplaySkins,
  useAllChampionTags,
  useDownloadedCount,
  useTotalCount,
  useStyles,
  DEFAULT_FILTERS
} from '../../hooks/useOptimizedState'
import { useChampionData } from '../../hooks/useChampionData'
import { useSkinManagement } from '../../hooks/useSkinManagement'
import type { Champion, Skin } from '../../App'

interface SkinBrowserSectionProps {
  loading: boolean
  onEditCustomSkin: (skinPath: string, currentName: string) => Promise<void>
  onSkinClick: (champion: Champion, skin: Skin, chromaId?: string) => void
  selectedSkins: any[]
  fileUploadRef: React.MutableRefObject<any>
}

export function SkinBrowserSection({
  loading,
  onEditCustomSkin,
  onSkinClick,
  selectedSkins,
  fileUploadRef
}: SkinBrowserSectionProps) {
  const { t } = useTranslation()
  const { championData } = useChampionData()

  const [filters, setFilters] = useAtom(filtersAtom)
  const [skinSearchQuery, setSkinSearchQuery] = useAtom(skinSearchQueryAtom)
  const [viewMode, setViewMode] = useAtom(viewModeAtom)
  const setShowDownloadedSkinsDialog = useSetAtom(showDownloadedSkinsDialogAtom)

  const displaySkins = useDisplaySkins()
  const allChampionTags = useAllChampionTags()
  const downloadedCount = useDownloadedCount()
  const totalCount = useTotalCount()
  const styles = useStyles()

  const {
    downloadedSkins,
    favorites,
    loadDownloadedSkins,
    toggleFavorite,
    toggleChromaFavorite,
    deleteCustomSkin
  } = useSkinManagement()

  /**
   * Click handler for non-downloaded skins. Generates the .fantome from the
   * user's local WAD on demand, then selects the skin so the patcher run
   * picks it up. Author defaults to "bocchi" if the user never set one.
   */
  const handleGenerateLocal = useCallback(
    async (champion: Champion, skin: Skin) => {
      // When the local-only flag is lifted, this becomes a passthrough.
      if (!LOCAL_FANTOME_ONLY_MODE) {
        onSkinClick(champion, skin)
        return
      }
      const settings = (await window.api.getSettings()) as Record<string, unknown> | null
      const author = ((settings?.localFantomeAuthor as string) || 'bocchi').trim() || 'bocchi'
      const leagueDir = (settings?.localFantomeLeagueDir as string) || undefined

      const toastId = toast.loading(`Generating ${skin.name}…`, {
        description: `${champion.name} from your local WAD`
      })
      try {
        const res = await window.api.localFantomeGenerateForSkin({
          championKey: champion.key,
          skinNum: skin.num,
          // English name keeps the on-disk filename stable across UI locales —
          // the apply path and ChromaSelectionDialog match against the EN form.
          skinName: skin.nameEn || skin.name,
          author,
          leagueDir
        })
        if (!res?.success) {
          toast.error(`Failed: ${res?.error ?? 'unknown error'}`, { id: toastId })
          return
        }
        toast.success(`Generated ${skin.name}`, {
          id: toastId,
          description: 'Saved to your library'
        })
        // Pull the new file into the downloadedSkins list, then select the skin.
        await loadDownloadedSkins()
        onSkinClick(champion, skin)
      } catch (e) {
        toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`, { id: toastId })
      }
    },
    [onSkinClick, loadDownloadedSkins]
  )

  /**
   * Same flow as handleGenerateLocal but for chromas. chromaIndex is the
   * position in skin.chromaList; the backend uses that to pick the Nth
   * chroma-of-baseSkin row in the WAD listing (chromaList order == WAD order
   * for every champion checked so far).
   */
  const handleGenerateChroma = useCallback(
    async (champion: Champion, skin: Skin, chromaId: string, chromaIndex: number) => {
      if (!LOCAL_FANTOME_ONLY_MODE) {
        onSkinClick(champion, skin, chromaId)
        return
      }
      const settings = (await window.api.getSettings()) as Record<string, unknown> | null
      const author = ((settings?.localFantomeAuthor as string) || 'bocchi').trim() || 'bocchi'
      const leagueDir = (settings?.localFantomeLeagueDir as string) || undefined

      const toastId = toast.loading(`Generating ${skin.name} chroma ${chromaId}…`, {
        description: `${champion.name} from your local WAD`
      })
      try {
        const res = await window.api.localFantomeGenerateForSkin({
          championKey: champion.key,
          skinNum: skin.num,
          // English name keeps the on-disk filename stable across UI locales.
          skinName: skin.nameEn || skin.name,
          author,
          leagueDir,
          chromaIndex,
          chromaIdLabel: chromaId
        })
        if (!res?.success) {
          toast.error(`Failed: ${res?.error ?? 'unknown error'}`, { id: toastId })
          return
        }
        toast.success(`Generated ${skin.name} chroma ${chromaId}`, {
          id: toastId,
          description: 'Saved to your library'
        })
        await loadDownloadedSkins()
        onSkinClick(champion, skin, chromaId)
      } catch (e) {
        toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`, { id: toastId })
      }
    },
    [onSkinClick, loadDownloadedSkins]
  )

  if (!championData) return null

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        availableTags={allChampionTags}
        downloadedCount={downloadedCount}
        totalCount={totalCount}
        resultsCount={displaySkins.length}
        onClearFilters={() => setFilters(DEFAULT_FILTERS)}
      />
      <div className="px-8 pt-6 pb-4 flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder={t('skin.searchPlaceholder')}
          aria-label={t('skin.searchPlaceholder')}
          value={skinSearchQuery}
          onChange={(e) => setSkinSearchQuery(e.target.value)}
          className={styles.searchInput.className}
        />
        <div className="flex items-center gap-2">
          <FileUploadButton
            ref={fileUploadRef}
            champions={championData.champions}
            onSkinImported={loadDownloadedSkins}
          />
          <button
            onClick={() => setShowDownloadedSkinsDialog(true)}
            className={styles.manageButton.className}
            title={t('skins.manageDownloaded')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            {t('skins.manage')}
          </button>
          <GridViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
      </div>

      {/* Skin grid content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {displaySkins.length > 0 ? (
          <>
            <div className="px-8 pb-4 text-sm text-text-secondary">
              {t('skin.showing', { count: displaySkins.length })}
            </div>
            <div className="flex-1 relative" style={{ minHeight: 0 }}>
              <AutoSizer>
                {({ width, height }) => (
                  <VirtualizedSkinGrid
                    skins={displaySkins}
                    viewMode={viewMode}
                    downloadedSkins={downloadedSkins}
                    selectedSkins={selectedSkins}
                    favorites={favorites}
                    loading={loading}
                    onSkinClick={onSkinClick}
                    onToggleFavorite={toggleFavorite}
                    onToggleChromaFavorite={toggleChromaFavorite}
                    onDeleteCustomSkin={deleteCustomSkin}
                    onEditCustomSkin={onEditCustomSkin}
                    onGenerateLocal={handleGenerateLocal}
                    onGenerateChroma={handleGenerateChroma}
                    containerWidth={width}
                    containerHeight={height}
                  />
                )}
              </AutoSizer>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-secondary-200 dark:bg-secondary-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-text-secondary"
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
              <p className="text-text-secondary mb-2">No skins match your filters</p>
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
              >
                Clear all filters
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
