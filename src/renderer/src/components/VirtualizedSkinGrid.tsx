import React, { useMemo, useRef, useCallback } from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import type { Champion, Skin } from '../App'
import type { SelectedSkin } from '../store/atoms'

interface VirtualizedSkinGridProps {
  skins: Array<{ champion: Champion; skin: Skin }>
  viewMode: 'compact' | 'comfortable' | 'spacious' | 'list'
  downloadedSkins: Array<{ championName: string; skinName: string }>
  selectedSkins: SelectedSkin[]
  favorites: Set<string>
  loading: boolean
  onSkinClick: (champion: Champion, skin: Skin) => void
  onToggleFavorite: (champion: Champion, skin: Skin) => void
  containerWidth: number
  containerHeight: number
}

export const VirtualizedSkinGrid: React.FC<VirtualizedSkinGridProps> = ({
  skins,
  viewMode,
  downloadedSkins,
  selectedSkins,
  favorites,
  loading,
  onSkinClick,
  onToggleFavorite,
  containerWidth,
  containerHeight
}) => {
  const gridRef = useRef<Grid>(null)

  // Calculate grid dimensions based on view mode
  const { columnCount, columnWidth, rowHeight } = useMemo(() => {
    const gap = 24 // 6 * 4px (gap-6 in tailwind)
    const padding = 64 // 8 * 8px (px-8 in tailwind)
    const availableWidth = containerWidth - padding

    let cols: number
    let itemWidth: number
    let itemHeight: number

    switch (viewMode) {
      case 'compact':
        // Match: grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10
        if (availableWidth >= 1280)
          cols = 10 // xl
        else if (availableWidth >= 1024)
          cols = 8 // lg
        else if (availableWidth >= 768)
          cols = 6 // md
        else if (availableWidth >= 640)
          cols = 4 // sm
        else cols = 3
        itemWidth = (availableWidth - gap * (cols - 1)) / cols
        itemHeight = itemWidth * 1.49 + 40 // aspect-[0.67] + padding
        break
      case 'comfortable':
        // Match: grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6
        if (availableWidth >= 1280)
          cols = 6 // xl
        else if (availableWidth >= 1024)
          cols = 5 // lg
        else if (availableWidth >= 768)
          cols = 4 // md
        else if (availableWidth >= 640)
          cols = 3 // sm
        else cols = 2
        itemWidth = (availableWidth - gap * (cols - 1)) / cols
        itemHeight = itemWidth * 1.49 + 56 // aspect-[0.67] + padding
        break
      case 'spacious':
        // Match: grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4
        if (availableWidth >= 1024)
          cols = 4 // lg
        else if (availableWidth >= 768)
          cols = 3 // md
        else if (availableWidth >= 640)
          cols = 2 // sm
        else cols = 1
        itemWidth = (availableWidth - gap * (cols - 1)) / cols
        itemHeight = itemWidth * 1.49 + 80 // aspect-[0.67] + padding
        break
      default:
        cols = 1
        itemWidth = availableWidth
        itemHeight = 80 // List view height
    }

    return {
      columnCount: cols,
      columnWidth: itemWidth + gap,
      rowHeight: itemHeight + gap
    }
  }, [viewMode, containerWidth])

  const rowCount = Math.ceil(skins.length / columnCount)

  const getSkinImageUrl = (championKey: string, skinNum: number) => {
    return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championKey}_${skinNum}.jpg`
  }

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }) => {
      const index = rowIndex * columnCount + columnIndex
      if (index >= skins.length) return null

      const { champion, skin } = skins[index]
      const skinFileName = `${skin.nameEn || skin.name}.zip`.replace(/:/g, '')
      const isDownloaded = downloadedSkins.some(
        (ds) => ds.championName === champion.key && ds.skinName === skinFileName
      )
      const isFavorite = favorites.has(`${champion.key}_${skin.id}`)
      const isSelected = selectedSkins.some(
        (s) => s.championKey === champion.key && s.skinId === skin.id && !s.chromaId
      )

      // Adjust style to account for gap
      const adjustedStyle = {
        ...style,
        left: style.left + 32, // Add padding
        top: style.top + 24, // Add padding for search bar
        width: style.width - 24, // Subtract gap
        height: style.height - 24 // Subtract gap
      }

      if (viewMode === 'list') {
        return (
          <div style={adjustedStyle}>
            <div
              className={`flex items-center gap-4 p-3 bg-white dark:bg-charcoal-800 rounded-lg transition-all duration-200 cursor-pointer border-2
                ${
                  isSelected
                    ? 'border-terracotta-500 bg-terracotta-50 dark:bg-terracotta-950/20'
                    : 'border-charcoal-200 dark:border-charcoal-700 hover:border-charcoal-300 dark:hover:border-charcoal-600 hover:shadow-md dark:hover:shadow-dark-soft'
                }`}
              onClick={() => !loading && onSkinClick(champion, skin)}
            >
              <img
                src={getSkinImageUrl(champion.key, skin.num)}
                alt={skin.name}
                className="w-16 h-16 object-cover rounded"
                loading="lazy"
              />
              <div className="flex-1">
                <p className="font-medium text-charcoal-900 dark:text-charcoal-100">{skin.name}</p>
                <p className="text-sm text-charcoal-600 dark:text-charcoal-400">{champion.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-terracotta-500 border-terracotta-500'
                      : 'bg-white dark:bg-charcoal-700 border-charcoal-300 dark:border-charcoal-600'
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
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
                    onToggleFavorite(champion, skin)
                  }}
                >
                  {isFavorite ? '❤️' : '🤍'}
                </button>
              </div>
            </div>
          </div>
        )
      }

      // Card views
      return (
        <div style={adjustedStyle}>
          <div
            className={`group relative bg-cream-50 dark:bg-charcoal-800 rounded-xl overflow-hidden transform transition-all duration-300 ease-out border-2 h-full
              ${
                isSelected
                  ? 'border-terracotta-500 shadow-xl dark:shadow-dark-large scale-[1.02]'
                  : 'border-charcoal-200 dark:border-charcoal-700 hover:shadow-xl dark:hover:shadow-dark-large shadow-md dark:shadow-dark-soft hover:-translate-y-1 hover:scale-[1.02] hover:border-charcoal-300 dark:hover:border-charcoal-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <div className="relative aspect-[0.67] overflow-hidden bg-charcoal-100 dark:bg-charcoal-900">
              <img
                src={getSkinImageUrl(champion.key, skin.num)}
                alt={skin.name}
                className="w-full h-full object-cover"
                onClick={() => !loading && onSkinClick(champion, skin)}
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
              <div className="absolute top-2 left-2 px-2 py-1 bg-black bg-opacity-75 backdrop-blur-sm rounded-lg text-xs text-white font-medium transform transition-all duration-300 group-hover:scale-105">
                {champion.name}
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-8 h-8 bg-terracotta-500 rounded-full flex items-center justify-center shadow-lg transform transition-all duration-300 group-hover:scale-110">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
              {isDownloaded && !isSelected && (
                <div
                  className="absolute bottom-2 right-2 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center shadow-soft transform transition-all duration-300 group-hover:scale-110"
                  title="Downloaded"
                >
                  <span className="text-white text-xs">↓</span>
                </div>
              )}
              <button
                className={`absolute bottom-2 left-2 w-8 h-8 rounded-full flex items-center justify-center transition-all
                    ${
                      isFavorite
                        ? 'bg-white/10 backdrop-blur-sm text-red-500'
                        : 'bg-white/10 backdrop-blur-sm text-white/70 hover:text-white hover:bg-white/20'
                    }`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(champion, skin)
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
        </div>
      )
    },
    [
      skins,
      columnCount,
      viewMode,
      downloadedSkins,
      selectedSkins,
      favorites,
      loading,
      onSkinClick,
      onToggleFavorite
    ]
  )

  return (
    <Grid
      ref={gridRef}
      columnCount={columnCount}
      columnWidth={columnWidth}
      height={containerHeight}
      rowCount={rowCount}
      rowHeight={rowHeight}
      width={containerWidth}
      className="scrollbar-thin scrollbar-thumb-charcoal-300 dark:scrollbar-thumb-charcoal-700 scrollbar-track-transparent"
    >
      {Cell}
    </Grid>
  )
}
