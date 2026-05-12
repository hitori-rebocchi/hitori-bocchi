import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import memoizeOne from 'memoize-one'
import {
  championSearchQueryAtom,
  filtersAtom,
  selectedChampionKeyAtom,
  showFavoritesOnlyAtom,
  skinSearchQueryAtom
} from '../atoms'
import { selectedChampionAtom, championDataAtom } from './champion.atoms'
import { favoritesAtom, downloadedSkinsAtom } from './skin.atoms'
import type { Champion, Skin } from '../../App'
import { getChampionDisplayName } from '../../utils/championUtils'
import { sanitizeSkinNameForPath } from '../../../../shared/utils/skinFilename'

// Helper function to check if a skin or any of its chromas are favorited
function isSkinOrChromaFavorited(
  favorites: Set<string>,
  championKey: string,
  skinId: string
): boolean {
  // Check if base skin is favorited
  if (favorites.has(`${championKey}_${skinId}_base`)) {
    return true
  }

  // Check if any chroma is favorited
  for (const key of favorites) {
    if (key.startsWith(`${championKey}_${skinId}_`) && !key.endsWith('_base')) {
      return true
    }
  }

  return false
}

interface DisplaySkin {
  champion: Champion
  skin: Skin
}

// Filtered champions based on search
export const filteredChampionsAtom = atom((get) => {
  const championData = get(championDataAtom)
  const searchQuery = get(championSearchQueryAtom)

  if (!championData?.champions) return []

  if (!searchQuery.trim()) return championData.champions

  const searchLower = searchQuery.toLowerCase()
  return championData.champions.filter((champ) => {
    const displayName = getChampionDisplayName(champ)
    return displayName.toLowerCase().includes(searchLower)
  })
})

// All unique champion tags
export const allChampionTagsAtom = atom((get) => {
  const championData = get(championDataAtom)
  if (!championData?.champions) return []

  const tagSet = new Set<string>()
  championData.champions.forEach((champ) => {
    champ.tags.forEach((tag) => tagSet.add(tag))
  })
  return Array.from(tagSet).sort()
})

// Rarity hierarchy for sorting (lower index = less rare)
const rarityOrder = [
  'kNoRarity',
  'kEpic',
  'kLegendary',
  'kUltimate',
  'kMythic',
  'kTranscendent',
  'kExalted'
]

// 1. Create champion-to-skins lookup (expensive, cache once)
export const championSkinsMapAtom = atom((get) => {
  const championData = get(championDataAtom)
  const downloadedSkins = get(downloadedSkinsAtom)

  if (!championData) return new Map<string, DisplaySkin[]>()

  const map = new Map<string, DisplaySkin[]>()

  // Build map for regular champions
  for (const champion of championData.champions) {
    const skins = champion.skins
      .filter((skin) => skin.num !== 0)
      .map((skin) => ({ champion, skin }))
    map.set(champion.key, skins)
  }

  // Build map for custom skins
  const customSkins: DisplaySkin[] = []
  const championCustomSkins = new Map<string, DisplaySkin[]>()

  downloadedSkins.forEach((downloadedSkin) => {
    if (downloadedSkin.skinName.includes('[User]')) {
      let champion: Champion | undefined

      if (downloadedSkin.championName && downloadedSkin.championName !== 'Custom') {
        champion = championData.champions.find(
          (c) => c.key.toLowerCase() === downloadedSkin.championName.toLowerCase()
        )
      }

      if (!champion) {
        champion = {
          id: -1,
          key: 'Custom',
          name: 'Custom',
          nameEn: 'Custom',
          title: 'Imported Mods',
          image: '',
          skins: [],
          tags: []
        }
      }

      const displayName = downloadedSkin.skinName
        .replace('[User] ', '')
        .replace(/\.(wad|zip|fantome|wad\.client)$/i, '')

      // If this [User] fantome's name lines up with one of the champion's
      // real Riot skins (or one of its chromas), suppress the separate tile
      // — VirtualizedSkinGrid already lights up the matching Riot card via
      // its [User]+skin.name fallback. Without this guard the on-demand
      // "click to generate" flow produces a duplicate card next to the
      // original (visible as both a dim Riot tile and a bright Custom tile).
      //
      // Match against `nameEn` AND `name` so a fantome generated under one
      // locale still dedups when the UI is set to another. Chromas are
      // matched as the suffix pattern `{base} {chromaId}` because that's
      // how local-fantome:generate-for-skin names them on disk.
      let matchesRiotSkin = false
      if (champion.key !== 'Custom') {
        const sanitizedDisplay = sanitizeSkinNameForPath(displayName).toLowerCase()
        const chromaMatch = sanitizedDisplay.match(/^(.+)\s+(\d+)$/)
        for (const s of champion.skins) {
          if (s.num === 0) continue
          const baseCandidates = [s.nameEn, s.name].filter(Boolean) as string[]
          const baseSanitized = baseCandidates.map((n) => sanitizeSkinNameForPath(n).toLowerCase())
          if (baseSanitized.includes(sanitizedDisplay)) {
            matchesRiotSkin = true
            break
          }
          if (chromaMatch) {
            const [, baseFromDisplay, chromaIdStr] = chromaMatch
            const chromaIdNum = parseInt(chromaIdStr, 10)
            if (baseSanitized.includes(baseFromDisplay)) {
              const chromaList = (s as { chromaList?: Array<{ id: number }> }).chromaList ?? []
              if (chromaList.some((c) => c.id === chromaIdNum)) {
                matchesRiotSkin = true
                break
              }
            }
          }
        }
      }
      if (matchesRiotSkin) {
        // The Riot tile handles its own "is downloaded" badge via the grid's
        // fallback. Nothing to add to either map.
        return
      }

      const customSkin: Skin = {
        id: `custom_${downloadedSkin.skinName}`,
        num: -1,
        name: displayName,
        nameEn: displayName,
        chromas: false,
        rarity: 'kNoRarity',
        rarityGemPath: null,
        isLegacy: false,
        skinType: 'custom',
        description: 'Custom imported mod',
        author: downloadedSkin.author
      }

      const displaySkin = { champion, skin: customSkin }

      // Always add to customSkins array (for "Custom" section in sidebar)
      customSkins.push(displaySkin)

      // Also add to champion-specific list if assigned to a real champion
      if (champion.key !== 'Custom') {
        const existing = championCustomSkins.get(champion.key) || []
        existing.push(displaySkin)
        championCustomSkins.set(champion.key, existing)
      }
    }
  })

  // Merge custom skins with champion skins
  championCustomSkins.forEach((customSkinsForChamp, championKey) => {
    const existing = map.get(championKey) || []
    map.set(championKey, [...existing, ...customSkinsForChamp])
  })

  // Add pure custom skins
  map.set('Custom', customSkins)

  return map
})

// 2. Base filtered skins (select champion's skins only)
export const baseFilteredSkinsAtom = atom((get) => {
  const championSkinsMap = get(championSkinsMapAtom)
  const selectedChampion = get(selectedChampionAtom)
  const selectedChampionKey = get(selectedChampionKeyAtom)

  if (selectedChampion) {
    return championSkinsMap.get(selectedChampion.key) || []
  } else if (selectedChampionKey === 'all') {
    // Flatten all skins
    return Array.from(championSkinsMap.values()).flat()
  } else if (selectedChampionKey === 'custom') {
    return championSkinsMap.get('Custom') || []
  }

  return []
})

// 3. Search filter (only active when searching)
export const searchFilteredSkinsAtom = atom((get) => {
  const championSkinsMap = get(championSkinsMapAtom)
  const skins = get(baseFilteredSkinsAtom)
  const searchQuery = get(skinSearchQueryAtom)

  // If searching globally, search all skins
  if (searchQuery.trim()) {
    const searchLower = searchQuery.toLowerCase()
    const allSkins = Array.from(championSkinsMap.values()).flat()
    return allSkins.filter(({ skin }) => skin.name.toLowerCase().includes(searchLower))
  }

  return skins
})

// 4. Favorites filter (only active when enabled)
export const favoritesFilteredSkinsAtom = atom((get) => {
  const skins = get(searchFilteredSkinsAtom)
  const showFavoritesOnly = get(showFavoritesOnlyAtom)

  if (!showFavoritesOnly) return skins

  const favorites = get(favoritesAtom)
  return skins.filter(({ champion, skin }) =>
    isSkinOrChromaFavorited(favorites, champion.key, skin.id)
  )
})

// 5. Download / availability filter.
// "downloaded" in local-only mode means a `[User] {base}.fantome` exists for
// this champion+skin. Probe under both nameEn and the localized name, and
// sanitize the base so K/DA-style names match (on-disk loses the slash).
export const downloadFilteredSkinsAtom = atom((get) => {
  const skins = get(favoritesFilteredSkinsAtom)
  const filters = get(filtersAtom)

  if (filters.downloadStatus === 'all') return skins

  const downloadedSkins = get(downloadedSkinsAtom)
  const exts = ['fantome', 'zip', 'wad', 'wad.client']

  return skins.filter(({ champion, skin }) => {
    const repoZipName = `${sanitizeSkinNameForPath(skin.nameEn || skin.name)}.zip`
    const userBases = [skin.nameEn, skin.name]
      .filter((n): n is string => Boolean(n && n.trim()))
      .map((n) => sanitizeSkinNameForPath(n))
    const userNames = new Set<string>()
    for (const base of userBases) {
      for (const ext of exts) {
        userNames.add(`[User] ${base}.${ext}`)
      }
    }
    const isDownloaded = downloadedSkins.some(
      (ds) =>
        ds.championName === champion.key &&
        (ds.skinName === repoZipName || userNames.has(ds.skinName))
    )
    return filters.downloadStatus === 'downloaded' ? isDownloaded : !isDownloaded
  })
})

// 6. Rarity filter
export const rarityFilteredSkinsAtom = atom((get) => {
  const skins = get(downloadFilteredSkinsAtom)
  const filters = get(filtersAtom)

  if (filters.rarity === 'all') return skins

  return skins.filter(({ skin }) => skin.rarity === filters.rarity)
})

// 7. Chroma filter
export const chromaFilteredSkinsAtom = atom((get) => {
  const skins = get(rarityFilteredSkinsAtom)
  const filters = get(filtersAtom)

  if (filters.chromaStatus === 'all') return skins

  return skins.filter(({ skin }) => {
    const hasChromas = skin.chromas && skin.chromaList && skin.chromaList.length > 0
    return filters.chromaStatus === 'has-chromas' ? hasChromas : !hasChromas
  })
})

// 8. Champion tag filter
export const tagFilteredSkinsAtom = atom((get) => {
  const skins = get(chromaFilteredSkinsAtom)
  const filters = get(filtersAtom)

  if (filters.championTags.length === 0) return skins

  return skins.filter(({ champion }) =>
    filters.championTags.some((tag: string) => champion.tags.includes(tag))
  )
})

// 9. Sorting (using memoize-one)
const sortSkins = memoizeOne((skins: DisplaySkin[], sortBy: string) => {
  return [...skins].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return (a.skin.nameEn || a.skin.name).localeCompare(b.skin.nameEn || b.skin.name)
      case 'name-desc':
        return (b.skin.nameEn || b.skin.name).localeCompare(a.skin.nameEn || a.skin.name)
      case 'skin-asc':
        return a.skin.num - b.skin.num
      case 'skin-desc':
        return b.skin.num - a.skin.num
      case 'champion':
        return (a.champion.nameEn || a.champion.name).localeCompare(
          b.champion.nameEn || b.champion.name
        )
      case 'rarity-asc': {
        const aIndex = rarityOrder.indexOf(a.skin.rarity)
        const bIndex = rarityOrder.indexOf(b.skin.rarity)
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
      }
      case 'rarity-desc': {
        const aIndex = rarityOrder.indexOf(a.skin.rarity)
        const bIndex = rarityOrder.indexOf(b.skin.rarity)
        return (bIndex === -1 ? 999 : bIndex) - (aIndex === -1 ? 999 : aIndex)
      }
      case 'winrate-desc':
        return (b.skin.winRate || 0) - (a.skin.winRate || 0)
      case 'winrate-asc':
        return (a.skin.winRate || 0) - (b.skin.winRate || 0)
      case 'pickrate-desc':
        return (b.skin.pickRate || 0) - (a.skin.pickRate || 0)
      case 'pickrate-asc':
        return (a.skin.pickRate || 0) - (b.skin.pickRate || 0)
      case 'totalgames-desc':
        return (b.skin.totalGames || 0) - (a.skin.totalGames || 0)
      case 'totalgames-asc':
        return (a.skin.totalGames || 0) - (b.skin.totalGames || 0)
      default:
        return 0
    }
  })
})

export const displaySkinsAtom = atom((get) => {
  const skins = get(tagFilteredSkinsAtom)
  const filters = get(filtersAtom)

  return sortSkins(skins, filters.sortBy)
})

// Skin statistics
export const skinStatsAtom = atom((get) => {
  const championData = get(championDataAtom)
  const downloadedSkins = get(downloadedSkinsAtom)

  let total = 0
  let downloaded = 0

  if (championData) {
    championData.champions.forEach((champion) => {
      champion.skins.forEach((skin) => {
        if (skin.num !== 0) {
          total++
          const skinFileName = `${sanitizeSkinNameForPath(skin.nameEn || skin.name)}.zip`
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
})

// Create selector for specific stats
export const downloadedCountAtom = selectAtom(skinStatsAtom, (stats) => stats.downloaded)
export const totalCountAtom = selectAtom(skinStatsAtom, (stats) => stats.total)
