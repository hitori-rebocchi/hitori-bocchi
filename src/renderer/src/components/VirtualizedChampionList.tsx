import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { VariableSizeList as List } from 'react-window'
import type { Champion } from '../App'
import { getChampionDisplayName, getRomanizedFirstLetter } from '../utils/championUtils'
import { lcuSelectedChampionAtom } from '../store/atoms/lcu.atoms'
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip'

interface VirtualizedChampionListProps {
  champions: Champion[]
  selectedChampion: Champion | null
  selectedChampionKey: string | null
  onChampionSelect: (champion: Champion | null, key: string) => void
  height: number
  width: number
  isCollapsed?: boolean
}

export interface VirtualizedChampionListRef {
  scrollToLetter: (letter: string) => void
  getAvailableLetters: () => Set<string>
}

const VirtualizedChampionListComponent = forwardRef<
  VirtualizedChampionListRef,
  VirtualizedChampionListProps
>(
  (
    {
      champions,
      selectedChampion,
      selectedChampionKey,
      onChampionSelect,
      height,
      width,
      isCollapsed = false
    },
    ref
  ) => {
    const { t } = useTranslation()
    const listRef = useRef<List>(null)
    const lcuSelectedChampion = useAtomValue(lcuSelectedChampionAtom)

    // Group champions by first letter and create letter indices
    const { groupedChampions, letterIndices, availableLetters } = React.useMemo(() => {
      const items: Array<{
        type: 'all' | 'custom' | 'divider' | 'letter' | 'champion' | 'lcu-pinned'
        data?: any
      }> = []
      const indices: Record<string, number> = {}
      const letters = new Set<string>()

      // Pin the LCU-selected champion at the very top when one is picked in champ select.
      if (lcuSelectedChampion) {
        items.push({ type: 'lcu-pinned', data: lcuSelectedChampion })
        items.push({ type: 'divider' })
      }

      // Add "All Champions" option
      items.push({ type: 'all' })
      items.push({ type: 'custom' })
      items.push({ type: 'divider' })

      if (isCollapsed) {
        // In collapsed mode, just add all champions without letter headers
        champions.forEach((champion) => {
          items.push({ type: 'champion', data: champion })
          const firstLetter = getRomanizedFirstLetter(champion)
          letters.add(firstLetter)
        })
      } else {
        // In expanded mode, group by letter
        let lastLetter = ''
        champions.forEach((champion) => {
          const firstLetter = getRomanizedFirstLetter(champion)
          if (firstLetter !== lastLetter) {
            indices[firstLetter] = items.length
            items.push({ type: 'letter', data: firstLetter })
            lastLetter = firstLetter
            letters.add(firstLetter)
          }
          items.push({ type: 'champion', data: champion })
        })
      }

      return { groupedChampions: items, letterIndices: indices, availableLetters: letters }
    }, [champions, isCollapsed, lcuSelectedChampion])

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        scrollToLetter: (letter: string) => {
          if (!isCollapsed && letterIndices[letter] !== undefined && listRef.current) {
            listRef.current.scrollToItem(letterIndices[letter], 'start')
          }
        },
        getAvailableLetters: () => availableLetters
      }),
      [letterIndices, availableLetters, isCollapsed]
    )

    // VariableSizeList caches item heights per index. When `groupedChampions`
    // changes (e.g. an LCU-pinned entry is prepended or removed) the indices
    // shift but the cache keeps the old heights, which causes adjacent cards
    // to render on top of each other. Invalidate the cache whenever the
    // grouped list changes.
    useEffect(() => {
      listRef.current?.resetAfterIndex(0)
    }, [groupedChampions])

    const getItemHeight = (index: number) => {
      const item = groupedChampions[index]
      switch (item.type) {
        // Card rows: image h-10 (40) + py-3 (24) + border-2 (4) + my-1 (8) = 76.
        // The old value (64) clipped the my-1 margin so adjacent cards
        // visually overlapped, especially noticeable for "All"/"Custom" which
        // sit next to each other without a divider.
        case 'all':
        case 'custom':
        case 'champion':
        case 'lcu-pinned':
          return 76
        case 'divider':
          return 17
        case 'letter':
          return 36
        default:
          return 0
      }
    }

    const Row = useCallback(
      ({ index, style }) => {
        const item = groupedChampions[index]

        switch (item.type) {
          case 'all':
            return (
              <div style={style}>
                {isCollapsed ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`flex items-center justify-center px-3 py-3 cursor-pointer transition-all duration-200 mx-2 my-1 rounded-lg border-2
                        ${
                          selectedChampion === null && selectedChampionKey === 'all'
                            ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                            : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                        }`}
                          onClick={() => onChampionSelect(null, 'all')}
                        >
                          <div className="w-10 h-10 rounded-lg bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center">
                            <span className="text-lg font-bold">A</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" sideOffset={5}>
                          <p>{t('champion.allChampions')}</p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div
                    className={`flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-200 mx-3 my-1 rounded-lg border-2
                  ${
                    selectedChampion === null && selectedChampionKey === 'all'
                      ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                  }`}
                    onClick={() => onChampionSelect(null, 'all')}
                  >
                    <div className="w-10 h-10 rounded-lg bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center">
                      <span className="text-lg font-bold">A</span>
                    </div>
                    <span className="text-sm font-medium">{t('champion.allChampions')}</span>
                  </div>
                )}
              </div>
            )

          case 'custom':
            return (
              <div style={style}>
                {isCollapsed ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`flex items-center justify-center px-3 py-3 cursor-pointer transition-all duration-200 mx-2 my-1 rounded-lg border-2
                        ${
                          selectedChampion === null && selectedChampionKey === 'custom'
                            ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                            : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                        }`}
                          onClick={() => onChampionSelect(null, 'custom')}
                        >
                          <div className="w-10 h-10 rounded-lg bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center">
                            <span className="text-lg font-bold">C</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" sideOffset={5}>
                          <p>{t('champion.customMods')}</p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div
                    className={`flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-200 mx-3 my-1 rounded-lg border-2
                  ${
                    selectedChampion === null && selectedChampionKey === 'custom'
                      ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                  }`}
                    onClick={() => onChampionSelect(null, 'custom')}
                  >
                    <div className="w-10 h-10 rounded-lg bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center">
                      <span className="text-lg font-bold">C</span>
                    </div>
                    <span className="text-sm font-medium">{t('champion.customMods')}</span>
                  </div>
                )}
              </div>
            )

          case 'divider':
            return (
              <div style={style}>
                <div className="mx-6 my-2 border-b border-border"></div>
              </div>
            )

          case 'lcu-pinned': {
            const champion = item.data as Champion
            const isActive = selectedChampion?.key === champion.key
            const dotIndicator = (
              <span
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary-500 border-2 border-surface"
                aria-hidden="true"
              />
            )
            return (
              <div style={style}>
                {isCollapsed ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`relative flex items-center justify-center px-3 py-3 cursor-pointer transition-all duration-200 mx-2 my-1 rounded-lg border-2
                        ${
                          isActive
                            ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                            : 'bg-primary/5 hover:bg-primary/10 text-text-primary border-primary/30'
                        }`}
                          onClick={() => onChampionSelect(champion, champion.key)}
                        >
                          <img
                            src={champion.image}
                            alt={getChampionDisplayName(champion)}
                            className="w-10 h-10 rounded-lg object-cover"
                            loading="lazy"
                          />
                          {dotIndicator}
                        </div>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" sideOffset={5}>
                          <p className="font-medium">{champion.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('champion.lcuPinnedHint')}
                          </p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div
                    className={`relative flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-200 mx-3 my-1 rounded-lg border-2
                  ${
                    isActive
                      ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                      : 'bg-primary/5 hover:bg-primary/10 text-text-primary border-primary/30'
                  }`}
                    onClick={() => onChampionSelect(champion, champion.key)}
                  >
                    <div className="relative">
                      <img
                        src={champion.image}
                        alt={getChampionDisplayName(champion)}
                        className="w-10 h-10 rounded-lg"
                        loading="lazy"
                      />
                      {dotIndicator}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{champion.name}</span>
                      <span
                        className={`text-[10px] font-semibold tracking-wider uppercase ${
                          isActive ? 'text-white/80' : 'text-primary'
                        }`}
                      >
                        {t('champion.lcuPinnedLabel')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          }

          case 'letter':
            return (
              <div style={style}>
                <div className="px-6 py-3 text-xs font-bold text-text-secondary uppercase tracking-wider">
                  {item.data}
                </div>
              </div>
            )

          case 'champion': {
            const champion = item.data as Champion
            return (
              <div style={style}>
                {isCollapsed ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`flex items-center justify-center px-3 py-3 cursor-pointer transition-all duration-200 mx-2 my-1 rounded-lg border-2
                        ${
                          selectedChampion?.key === champion.key
                            ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                            : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                        }`}
                          onClick={() => onChampionSelect(champion, champion.key)}
                        >
                          <img
                            src={champion.image}
                            alt={getChampionDisplayName(champion)}
                            className="w-10 h-10 rounded-lg object-cover"
                            loading="lazy"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" sideOffset={5}>
                          <p className="font-medium">{champion.name}</p>
                          <p className="text-xs text-muted-foreground">{champion.title}</p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div
                    className={`flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-200 mx-3 my-1 rounded-lg border-2
                  ${
                    selectedChampion?.key === champion.key
                      ? 'bg-primary-500 text-white shadow-md dark:shadow-dark-soft border-primary-600 scale-[1.02]'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-text-primary border-transparent hover:border-border'
                  }`}
                    onClick={() => onChampionSelect(champion, champion.key)}
                  >
                    <img
                      src={champion.image}
                      alt={getChampionDisplayName(champion)}
                      className="w-10 h-10 rounded-lg"
                      loading="lazy"
                    />
                    <span className="text-sm font-medium">{champion.name}</span>
                  </div>
                )}
              </div>
            )
          }

          default:
            return null
        }
      },
      [groupedChampions, selectedChampion, selectedChampionKey, t, onChampionSelect, isCollapsed]
    )

    // Calculate total height based on dynamic item heights
    const totalHeight = groupedChampions.reduce((sum, _, index) => sum + getItemHeight(index), 0)

    return (
      <List
        ref={listRef}
        height={Math.min(height, totalHeight)}
        itemCount={groupedChampions.length}
        itemSize={getItemHeight}
        width={width}
        className="scrollbar-thin scrollbar-thumb-charcoal-300 dark:scrollbar-thumb-charcoal-700 scrollbar-track-transparent"
        style={{ overflow: 'auto' }}
      >
        {Row}
      </List>
    )
  }
)

// Add display name for debugging
VirtualizedChampionListComponent.displayName = 'VirtualizedChampionList'

// Export the component
export const VirtualizedChampionList = VirtualizedChampionListComponent
