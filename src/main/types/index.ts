export interface Preset {
  id: string
  name: string
  description: string
  selectedMods?: string[]
  selectedSkins?: string[]
  gamePath: string
  noTFT?: boolean
  ignoreConflict?: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ModInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  installed: boolean
}

export interface SkinInfo {
  championName: string
  skinName: string
  url: string
  localPath?: string
  source?: 'repository' | 'user'
}
