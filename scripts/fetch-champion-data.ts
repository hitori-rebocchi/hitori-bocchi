import axios from 'axios'
import * as fs from 'fs/promises'
import * as path from 'path'

const SUPPORTED_LANGUAGES = ['en_US', 'vi_VN']
const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com'
const DELAY_BETWEEN_REQUESTS = 50

interface Skin {
  id: string
  num: number
  name: string
  nameEn?: string
  chromas: boolean
}

interface Champion {
  id: number
  key: string
  name: string
  title: string
  image: string
  tags: string[]
  skins: Skin[]
}

interface ChampionData {
  version: string
  lastUpdated: string
  champions: Champion[]
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getLatestVersion(): Promise<string> {
  const response = await axios.get(`${DDRAGON_BASE_URL}/api/versions.json`)
  return response.data[0]
}

async function fetchChampionData(version: string, language: string): Promise<Champion[]> {
  console.log(`Fetching champion data for ${language}...`)

  // Fetch basic champion list
  const listUrl = `${DDRAGON_BASE_URL}/cdn/${version}/data/${language}/champion.json`
  const listResponse = await axios.get(listUrl)
  const championList = listResponse.data.data

  const champions: Champion[] = []
  const championKeys = Object.keys(championList)

  // Fetch detailed data for each champion
  for (let i = 0; i < championKeys.length; i++) {
    const key = championKeys[i]
    const champion = championList[key]

    console.log(`  Fetching ${champion.name} (${i + 1}/${championKeys.length})...`)

    const detailUrl = `${DDRAGON_BASE_URL}/cdn/${version}/data/${language}/champion/${key}.json`
    const detailResponse = await axios.get(detailUrl)
    const detailData = detailResponse.data.data[key]

    const championData: Champion = {
      id: parseInt(detailData.key),
      key: detailData.id,
      name: detailData.name,
      title: detailData.title,
      image: `${DDRAGON_BASE_URL}/cdn/${version}/img/champion/${detailData.image.full}`,
      tags: detailData.tags,
      skins: detailData.skins.map((skin: any) => ({
        id: `${detailData.key}_${skin.num}`,
        num: skin.num,
        name: skin.name === 'default' ? detailData.name : skin.name,
        chromas: skin.chromas || false
      }))
    }

    champions.push(championData)

    // Add delay between requests
    if (i < championKeys.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  // Sort champions by name
  champions.sort((a, b) => a.name.localeCompare(b.name))

  return champions
}

async function main() {
  try {
    // Create data directory
    const dataDir = path.join(process.cwd(), 'data')
    await fs.mkdir(dataDir, { recursive: true })

    // Get latest version
    console.log('Fetching latest version...')
    const version = await getLatestVersion()
    console.log(`Latest version: ${version}`)

    // Store all fetched data
    const allData: Record<string, ChampionData> = {}

    // Fetch data for each language
    for (const language of SUPPORTED_LANGUAGES) {
      const champions = await fetchChampionData(version, language)

      // Save to file
      const data: ChampionData = {
        version,
        lastUpdated: new Date().toISOString(),
        champions
      }

      allData[language] = data

      const filePath = path.join(dataDir, `champion-data-${language}.json`)
      await fs.writeFile(filePath, JSON.stringify(data, null, 2))
      console.log(`Saved ${filePath}`)
    }

    console.log('All champion data fetched successfully!')
  } catch (error) {
    console.error('Error fetching champion data:', error)
    process.exit(1)
  }
}

main()
