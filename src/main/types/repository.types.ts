export interface SkinRepository {
  id: string
  name: string
  owner: string
  repo: string
  branch: string
  skinsPath: string
  isDefault: boolean
  isCustom: boolean
  lastChecked?: Date
  status?: 'active' | 'error' | 'checking' | 'unchecked'
}

export interface RepositorySettings {
  repositories: SkinRepository[]
  activeRepositoryId: string
  allowMultipleActive: boolean
}

export const LEAGUESKINS_REPO = {
  owner: 'Alban1911',
  repo: 'LeagueSkins',
  branch: 'main',
  skinsPath: 'skins'
} as const

export const DEFAULT_REPOSITORY: SkinRepository = {
  id: 'leagueskins-default',
  name: 'LeagueSkins Official',
  owner: LEAGUESKINS_REPO.owner,
  repo: LEAGUESKINS_REPO.repo,
  branch: LEAGUESKINS_REPO.branch,
  skinsPath: LEAGUESKINS_REPO.skinsPath,
  isDefault: true,
  isCustom: false,
  status: 'unchecked'
}

export const BUNDLED_REPOSITORIES: SkinRepository[] = [
  DEFAULT_REPOSITORY,
  {
    id: 'syy-leagueskins',
    name: 'LeagueSkins (syy674998887)',
    owner: 'syy674998887',
    repo: 'LeagueSkins',
    branch: 'main',
    skinsPath: 'skins',
    isDefault: false,
    isCustom: false,
    status: 'unchecked'
  }
]
