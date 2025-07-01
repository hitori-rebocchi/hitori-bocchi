import axios from 'axios'

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
  nameEn?: string // English name for download purposes
  chromas: boolean
}

export class ChampionDataService {
  private apiVersion: string = ''
  private supportedLanguages = ['en_US', 'vi_VN']
  private githubDataUrl = 'https://raw.githubusercontent.com/nguyenvu/bocchi/champion-data/data'
  private cachedData: Map<string, { version: string; champions: Champion[] }> = new Map()

  constructor() {
    console.log('ChampionDataService constructor')
  }

  private async getApiVersion(): Promise<string> {
    const response = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json')
    return response.data[0]
  }

  private async getChampionDetails(champId: string, language: string = 'en_US'): Promise<any> {
    const url = `https://ddragon.leagueoflegends.com/cdn/${this.apiVersion}/data/${language}/champion/${champId}.json`
    const response = await axios.get(url)
    return response.data.data[champId]
  }

  public async fetchAndSaveChampionData(
    language: string = 'en_US'
  ): Promise<{ success: boolean; message: string; championCount?: number }> {
    try {
      // Try to fetch from GitHub first
      const githubUrl = `${this.githubDataUrl}/champion-data-${language}.json`

      try {
        const response = await axios.get(githubUrl)
        const data = response.data

        // If non-English, also fetch English data to add English skin names
        if (language !== 'en_US') {
          try {
            const englishUrl = `${this.githubDataUrl}/champion-data-en_US.json`
            const englishResponse = await axios.get(englishUrl)
            const englishData = englishResponse.data

            // Create a map of English skin names
            const englishSkinNames: Record<string, string> = {}
            englishData.champions.forEach((champion: Champion) => {
              champion.skins.forEach((skin: Skin) => {
                englishSkinNames[skin.id] = skin.name
              })
            })

            // Add English names to non-English skins
            data.champions.forEach((champion: Champion) => {
              champion.skins.forEach((skin: Skin) => {
                const englishName = englishSkinNames[skin.id]
                if (englishName) {
                  skin.nameEn = englishName
                }
              })
            })
          } catch (error) {
            console.error('Failed to fetch English skin names from CDN:', error)
          }
        }

        // Cache the data in memory
        this.cachedData.set(language, data)

        // Update apiVersion for consistency
        this.apiVersion = data.version

        return {
          success: true,
          message: `Successfully fetched data for ${data.champions.length} champions from GitHub`,
          championCount: data.champions.length
        }
      } catch (githubError) {
        console.log('Failed to fetch from GitHub, falling back to Riot API:', githubError)
        // Fall back to original implementation if GitHub fetch fails
      }

      // Original implementation as fallback
      // Get latest API version
      this.apiVersion = await this.getApiVersion()

      // Get all champions in the specified language
      const championsUrl = `https://ddragon.leagueoflegends.com/cdn/${this.apiVersion}/data/${language}/champion.json`
      const response = await axios.get(championsUrl)
      const championsData = response.data.data

      const champions: Champion[] = []

      // Fetch detailed data for each champion
      for (const [champId, champBasicInfo] of Object.entries(championsData) as [string, any][]) {
        try {
          const champDetails = await this.getChampionDetails(champId, language)

          // If we're not fetching English, also get English skin names for download
          const englishSkinNames: { [key: string]: string } = {}
          if (language !== 'en_US') {
            try {
              const champDetailsEn = await this.getChampionDetails(champId, 'en_US')
              champDetailsEn.skins.forEach((skin: any) => {
                englishSkinNames[skin.id] = skin.name
              })
            } catch (error) {
              console.error(`Failed to fetch English names for ${champId}:`, error)
            }
          }

          const champion: Champion = {
            id: parseInt(champBasicInfo.key),
            key: champId,
            name: champBasicInfo.name,
            title: champBasicInfo.title,
            image: `https://ddragon.leagueoflegends.com/cdn/${this.apiVersion}/img/champion/${champBasicInfo.image.full}`,
            tags: champDetails.tags || [],
            skins: champDetails.skins.map((skin: any) => ({
              id: skin.id,
              num: skin.num,
              name: skin.name,
              nameEn: language !== 'en_US' ? englishSkinNames[skin.id] || skin.name : undefined,
              chromas: skin.chromas || false
            }))
          }

          champions.push(champion)

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 50))
        } catch (error) {
          console.error(`Failed to fetch details for ${champId}:`, error)
        }
      }

      // Sort champions by name
      champions.sort((a, b) => a.name.localeCompare(b.name))

      // Cache the data in memory
      const data = {
        version: this.apiVersion,
        lastUpdated: new Date().toISOString(),
        champions
      }

      this.cachedData.set(language, data)

      return {
        success: true,
        message: `Successfully fetched data for ${champions.length} champions`,
        championCount: champions.length
      }
    } catch (error) {
      console.error('Error fetching champion data:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch champion data'
      }
    }
  }

  public async loadChampionData(
    language: string = 'en_US'
  ): Promise<{ version: string; champions: Champion[] } | null> {
    // Check if we have cached data
    const cached = this.cachedData.get(language)
    if (cached) {
      return cached
    }

    // If no cached data, fetch it
    const result = await this.fetchAndSaveChampionData(language)
    if (result.success) {
      return this.cachedData.get(language) || null
    }

    return null
  }

  public async checkForUpdates(language: string = 'en_US'): Promise<boolean> {
    try {
      const currentData = this.cachedData.get(language)
      if (!currentData) return true // No data, needs update

      // Try to check GitHub version first
      try {
        const githubUrl = `${this.githubDataUrl}/champion-data-${language}.json`
        const response = await axios.get(githubUrl, {
          headers: {
            'Cache-Control': 'no-cache'
          }
        })
        const githubData = response.data
        return currentData.version !== githubData.version
      } catch {
        // Fall back to checking Riot API version
        console.log('Failed to check GitHub version, falling back to Riot API')
        const latestVersion = await this.getApiVersion()
        return currentData.version !== latestVersion
      }
    } catch (error) {
      console.error('Error checking for updates:', error)
      return true // On error, assume update needed
    }
  }

  public async fetchAllLanguages(): Promise<{ success: boolean; message: string }> {
    try {
      for (const lang of this.supportedLanguages) {
        console.log(`Fetching champion data for ${lang}`)
        await this.fetchAndSaveChampionData(lang)
      }
      return {
        success: true,
        message: 'Successfully fetched data for all languages'
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch data'
      }
    }
  }
}
