import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { ViewMode } from '../components/GridViewToggle'
import type { FilterOptions } from '../components/FilterPanel'

// View mode atom with localStorage persistence
export const viewModeAtom = atomWithStorage<ViewMode>('cslol-view-mode', 'comfortable')

// Filters atom with localStorage persistence
export const filtersAtom = atomWithStorage<FilterOptions>('cslol-filters', {
  downloadStatus: 'all',
  chromaStatus: 'all',
  championTags: [],
  sortBy: 'name-asc'
})

// Show favorites only atom
export const showFavoritesOnlyAtom = atomWithStorage<boolean>('cslol-show-favorites', false)

// Search queries (not persisted as they should reset on refresh)
export const championSearchQueryAtom = atom<string>('')
export const skinSearchQueryAtom = atom<string>('')

// Selected skins for batch processing
export interface SelectedSkin {
  championKey: string
  championName: string
  skinId: string
  skinName: string
  skinNameEn?: string
  skinNum: number
  chromaId?: string
  isDownloaded?: boolean
}

export const selectedSkinsAtom = atomWithStorage<SelectedSkin[]>('cslol-selected-skins', [])

// UI state atoms
export const selectedChampionKeyAtom = atomWithStorage<string | null>(
  'cslol-selected-champion',
  null
)
export const filterPanelExpandedAtom = atomWithStorage<boolean>(
  'cslol-filter-panel-expanded',
  false
)
export const selectedSkinsDrawerExpandedAtom = atomWithStorage<boolean>(
  'cslol-selected-skins-drawer-expanded',
  false
)
