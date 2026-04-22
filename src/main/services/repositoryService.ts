import axios from 'axios'
import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import {
  SkinRepository,
  RepositorySettings,
  DEFAULT_REPOSITORY,
  BUNDLED_REPOSITORIES
} from '../types/repository.types'
import { settingsService } from './settingsService'
import { championDataService } from './championDataService'

export class RepositoryService {
  private static instance: RepositoryService

  // Repository management
  private repositories: SkinRepository[] = []
  private activeRepositoryId: string = DEFAULT_REPOSITORY.id

  // skin_ids.json: maps skin/chroma ID → repo name
  private skinIdsMap: Map<string, string> = new Map()
  private skinIdsReverseMap: Map<string, string> = new Map()
  private skinIdsFetchPromise: Promise<void> | null = null

  private constructor() {
    this.loadRepositories()
    // Fetch skin IDs in background
    this.fetchSkinIds()
  }

  /**
   * Fetches skin_ids.json from the LeagueSkins repo and caches it
   */
  async fetchSkinIds(): Promise<void> {
    // Deduplicate concurrent calls
    if (this.skinIdsFetchPromise) return this.skinIdsFetchPromise

    this.skinIdsFetchPromise = this.fetchSkinIdsInternal()
    try {
      await this.skinIdsFetchPromise
    } finally {
      this.skinIdsFetchPromise = null
    }
  }

  private async fetchSkinIdsInternal(): Promise<void> {
    const cacheDir = path.join(app.getPath('userData'), 'champion-data')
    const cachePath = path.join(cacheDir, 'skin-ids.json')

    // Try loading from disk cache first
    try {
      if (existsSync(cachePath)) {
        const raw = await fs.readFile(cachePath, 'utf-8')
        const data = JSON.parse(raw) as Record<string, string>
        this.buildSkinIdsMaps(data)
        console.log(`[SkinIds] Loaded ${this.skinIdsMap.size} entries from disk cache`)
      }
    } catch {
      // Cache read failed, will fetch from network
    }

    // Fetch fresh data from GitHub
    try {
      const url =
        'https://raw.githubusercontent.com/Alban1911/LeagueSkins/refs/heads/main/resources/en/skin_ids.json'
      const response = await axios.get<Record<string, string>>(url, { timeout: 15000 })
      const data = response.data
      this.buildSkinIdsMaps(data)

      // Save to disk
      try {
        if (!existsSync(cacheDir)) {
          await fs.mkdir(cacheDir, { recursive: true })
        }
        await fs.writeFile(cachePath, JSON.stringify(data), 'utf-8')
      } catch (err) {
        console.error('[SkinIds] Failed to save to disk:', err)
      }

      console.log(`[SkinIds] Fetched ${this.skinIdsMap.size} entries from GitHub`)
    } catch (err) {
      if (this.skinIdsMap.size > 0) {
        console.warn('[SkinIds] Network fetch failed, using disk cache')
      } else {
        console.error('[SkinIds] Failed to fetch skin_ids.json:', err)
      }
    }
  }

  private buildSkinIdsMaps(data: Record<string, string>): void {
    this.skinIdsMap.clear()
    this.skinIdsReverseMap.clear()
    for (const [id, name] of Object.entries(data)) {
      this.skinIdsMap.set(id, name)
      this.skinIdsReverseMap.set(name, id)
    }
  }

  /**
   * Look up a skin/chroma name by its Riot ID from skin_ids.json
   */
  getSkinNameById(id: string): string | null {
    return this.skinIdsMap.get(id) || null
  }

  /**
   * Reverse lookup: get the Riot ID for a skin/chroma name from skin_ids.json
   */
  getSkinIdByName(name: string): string | null {
    return this.skinIdsReverseMap.get(name) || null
  }

  /**
   * Ensures skin IDs are loaded before using them
   */
  async ensureSkinIds(): Promise<void> {
    if (this.skinIdsMap.size === 0) {
      await this.fetchSkinIds()
    }
  }

  static getInstance(): RepositoryService {
    if (!RepositoryService.instance) {
      RepositoryService.instance = new RepositoryService()
    }
    return RepositoryService.instance
  }

  // --- Repository management ---

  private loadRepositories(): void {
    try {
      const settings = settingsService.get('repositorySettings') as RepositorySettings
      if (settings) {
        const storedRepositories = Array.isArray(settings.repositories) ? settings.repositories : []
        this.repositories =
          storedRepositories.length > 0 ? storedRepositories : [...BUNDLED_REPOSITORIES]
        this.activeRepositoryId = settings.activeRepositoryId || DEFAULT_REPOSITORY.id

        // Ensure all bundled repositories exist
        for (const bundled of BUNDLED_REPOSITORIES) {
          if (!this.repositories.find((repo) => repo.id === bundled.id)) {
            this.repositories.push({ ...bundled })
          }
        }

        // Ensure active repository points to a valid entry
        if (!this.repositories.find((repo) => repo.id === this.activeRepositoryId)) {
          this.activeRepositoryId = DEFAULT_REPOSITORY.id
          this.saveRepositories()
        }
      } else {
        this.repositories = [...BUNDLED_REPOSITORIES]
        this.activeRepositoryId = DEFAULT_REPOSITORY.id
        this.saveRepositories()
      }
    } catch (error) {
      console.error('Failed to load repositories:', error)
      this.repositories = [...BUNDLED_REPOSITORIES]
      this.activeRepositoryId = DEFAULT_REPOSITORY.id
    }
  }

  private saveRepositories(): void {
    try {
      const settings: RepositorySettings = {
        repositories: this.repositories,
        activeRepositoryId: this.activeRepositoryId,
        allowMultipleActive: false
      }
      settingsService.set('repositorySettings', settings)
    } catch (error) {
      console.error('Failed to save repositories:', error)
    }
  }

  getRepositories(): SkinRepository[] {
    return [...this.repositories]
  }

  getActiveRepository(): SkinRepository {
    const active = this.repositories.find((r) => r.id === this.activeRepositoryId)
    return active || DEFAULT_REPOSITORY
  }

  getRepositoryById(id: string): SkinRepository | undefined {
    return this.repositories.find((r) => r.id === id)
  }

  setActiveRepository(id: string): boolean {
    const repo = this.repositories.find((r) => r.id === id)
    if (repo) {
      this.activeRepositoryId = id
      this.saveRepositories()
      return true
    }
    return false
  }

  async addRepository(repository: Omit<SkinRepository, 'id' | 'status'>): Promise<SkinRepository> {
    const id = `${repository.owner}-${repository.repo}-${Date.now()}`

    const newRepo: SkinRepository = {
      ...repository,
      id,
      status: 'unchecked',
      isCustom: true,
      isDefault: false
    }

    const isValid = await this.validateRepository(newRepo)
    if (!isValid) {
      throw new Error('Invalid repository structure')
    }

    this.repositories.push(newRepo)
    this.saveRepositories()
    return newRepo
  }

  removeRepository(id: string): boolean {
    const repo = this.repositories.find((r) => r.id === id)
    if (!repo || repo.isDefault) {
      return false
    }

    if (this.activeRepositoryId === id) {
      return false
    }

    this.repositories = this.repositories.filter((r) => r.id !== id)
    this.saveRepositories()
    return true
  }

  updateRepository(id: string, updates: Partial<SkinRepository>): boolean {
    const index = this.repositories.findIndex((r) => r.id === id)
    if (index === -1) {
      return false
    }

    delete updates.id
    delete updates.isDefault

    this.repositories[index] = {
      ...this.repositories[index],
      ...updates
    }

    this.saveRepositories()
    return true
  }

  async validateRepository(repository: SkinRepository): Promise<boolean> {
    try {
      repository.status = 'checking'
      this.saveRepositories()

      const repoUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}`
      const repoResponse = await axios.get(repoUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Bocchi-LoL-Skin-Manager'
        },
        timeout: 10000
      })

      if (repoResponse.status !== 200) {
        repository.status = 'error'
        this.saveRepositories()
        return false
      }

      const skinsPath = repository.skinsPath || 'skins'
      const contentsUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/contents/${skinsPath}?ref=${repository.branch}`

      try {
        const contentsResponse = await axios.get(contentsUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Bocchi-LoL-Skin-Manager'
          },
          timeout: 10000
        })

        if (contentsResponse.status === 200 && Array.isArray(contentsResponse.data)) {
          repository.status = 'active'
          repository.lastChecked = new Date()
          this.saveRepositories()
          return true
        }
      } catch {
        console.error(`Skins folder not found in repository ${repository.owner}/${repository.repo}`)
      }

      repository.status = 'error'
      this.saveRepositories()
      return false
    } catch (error) {
      console.error(`Failed to validate repository ${repository.owner}/${repository.repo}:`, error)
      repository.status = 'error'
      this.saveRepositories()
      return false
    }
  }

  getRepositoryFromUrl(url: string): SkinRepository | undefined {
    const parsed = this.parseGitHubUrl(url)
    if (!parsed) return undefined

    return this.repositories.find((r) => r.owner === parsed.owner && r.repo === parsed.repo)
  }

  constructGitHubUrl(
    championName: string,
    skinFile: string,
    _isChroma?: boolean,
    _chromaBase?: string,
    championId?: number
  ): string {
    const activeRepo = this.getActiveRepository()
    const { owner, repo, branch, skinsPath } = activeRepo
    const baseUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${skinsPath}`

    // Resolve English champion name (repos use English names, not localized)
    let repoChampionName = championName
    if (championId) {
      const champion = championDataService.getChampionByIdSync(championId)
      if (champion) {
        repoChampionName = champion.nameEn || champion.name
      }
    }

    // Sanitize names for repo paths (remove chars illegal in filenames: colons, etc.)
    const sanitize = (s: string): string =>
      s
        .replace(/[<>:"/\\|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const safeChampion = sanitize(repoChampionName)

    // Check if this is a chroma (has 4-6 digit numeric ID at end of filename)
    const chromaMatch = skinFile.match(/^(.+?)\s+(\d{4,6})\.zip$/i)
    if (chromaMatch) {
      const chromaId = chromaMatch[2]
      const baseSkinName = sanitize(chromaMatch[1])

      // Look up chroma name from skin_ids.json
      const chromaName = this.getSkinNameById(chromaId)
      if (chromaName) {
        const safeChromaName = sanitize(chromaName)
        return `${baseUrl}/${encodeURIComponent(safeChampion)}/${encodeURIComponent(baseSkinName)}/${encodeURIComponent(safeChromaName)}/${encodeURIComponent(safeChromaName)}.zip`
      }

      // Fallback: try constructing from champion data
      if (championId) {
        const champion = championDataService.getChampionByIdSync(championId)
        if (champion) {
          for (const skin of champion.skins) {
            if (skin.chromas && skin.chromaList) {
              const chroma = skin.chromaList.find((c) => c.id.toString() === chromaId)
              if (chroma) {
                const safeSkinName = sanitize(skin.nameEn || skin.name)
                const fullChromaName = sanitize(`${skin.nameEn || skin.name} (${chroma.name})`)
                return `${baseUrl}/${encodeURIComponent(safeChampion)}/${encodeURIComponent(safeSkinName)}/${encodeURIComponent(fullChromaName)}/${encodeURIComponent(fullChromaName)}.zip`
              }
            }
          }
        }
      }

      console.warn(
        `[LeagueSkins URL] Chroma ${chromaId} not found in skin_ids.json or champion data`
      )
    }

    // Regular skin - nested: skins/{champion}/{skinName}/{skinName}.zip
    const skinName = sanitize(skinFile.replace(/\.zip$/i, ''))
    const safeSkinFile = `${skinName}.zip`
    return `${baseUrl}/${encodeURIComponent(safeChampion)}/${encodeURIComponent(skinName)}/${encodeURIComponent(safeSkinFile)}`
  }

  constructRawUrl(url: string): string {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
  }

  parseGitHubUrl(
    url: string
  ): { owner: string; repo: string; branch: string; path: string } | null {
    const patterns = [
      /github\.com\/([^/]+)\/([^/]+)\/(blob|raw)\/([^/]+)\/(.+)$/,
      /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) {
        if (url.includes('raw.githubusercontent.com')) {
          return {
            owner: match[1],
            repo: match[2],
            branch: match[3],
            path: match[4]
          }
        } else {
          return {
            owner: match[1],
            repo: match[2],
            branch: match[4],
            path: match[5]
          }
        }
      }
    }

    return null
  }
}

// Export singleton instance
export const repositoryService = RepositoryService.getInstance()
