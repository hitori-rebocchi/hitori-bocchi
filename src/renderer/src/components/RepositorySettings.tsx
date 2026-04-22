import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Check, X, AlertCircle, RefreshCw, Github, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { toast } from 'sonner'

interface Repository {
  id: string
  name: string
  owner: string
  repo: string
  branch: string
  skinsPath: string
  isDefault: boolean
  isCustom: boolean
  status?: 'active' | 'error' | 'checking' | 'unchecked'
  lastChecked?: Date
}

interface RepositorySettingsProps {
  disabled?: boolean
}

export function RepositorySettings({ disabled }: RepositorySettingsProps) {
  const { t } = useTranslation()
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [activeRepositoryId, setActiveRepositoryId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newRepo, setNewRepo] = useState({
    name: '',
    owner: '',
    repo: '',
    branch: 'main',
    skinsPath: 'skins'
  })
  const [repoUrl, setRepoUrl] = useState('')
  const [addingRepo, setAddingRepo] = useState(false)

  const loadRepositories = useCallback(async () => {
    try {
      setLoading(true)
      const result = await window.api.repositoryGetAll()
      if (result.success && result.data) {
        setRepositories(result.data)
      }

      const activeResult = await window.api.repositoryGetActive()
      if (activeResult.success && activeResult.data) {
        setActiveRepositoryId(activeResult.data.id)
      }
    } catch (error) {
      console.error('Failed to load repositories:', error)
      toast.error(t('settings.repositories.loadError', 'Failed to load repositories'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadRepositories()
  }, [loadRepositories])

  const handleSetActive = async (repositoryId: string) => {
    try {
      const result = await window.api.repositorySetActive(repositoryId)
      if (result.success) {
        setActiveRepositoryId(repositoryId)
        toast.success(t('settings.repositories.setActiveSuccess', 'Repository set as active'))
      } else {
        toast.error(t('settings.repositories.setActiveError', 'Failed to set active repository'))
      }
    } catch (error) {
      console.error('Failed to set active repository:', error)
      toast.error(t('settings.repositories.setActiveError', 'Failed to set active repository'))
    }
  }

  const handleValidate = async (repositoryId: string) => {
    try {
      setValidating(repositoryId)
      const result = await window.api.repositoryValidate(repositoryId)
      if (result.success) {
        toast.success(
          result.data
            ? t('settings.repositories.validation.valid', 'Repository is valid')
            : t('settings.repositories.validation.invalid', 'Repository is invalid')
        )
        await loadRepositories()
      } else {
        toast.error(t('settings.repositories.validation.error', 'Validation failed'))
      }
    } catch (error) {
      console.error('Failed to validate repository:', error)
      toast.error(t('settings.repositories.validation.error', 'Validation failed'))
    } finally {
      setValidating(null)
    }
  }

  const handleRemove = async (repositoryId: string) => {
    if (repositoryId === activeRepositoryId) {
      toast.error(
        t('settings.repositories.cannotRemoveActive', 'Cannot remove the active repository')
      )
      return
    }

    if (
      !confirm(
        t('settings.repositories.confirmRemove', 'Are you sure you want to remove this repository?')
      )
    ) {
      return
    }

    try {
      const result = await window.api.repositoryRemove(repositoryId)
      if (result.success) {
        setRepositories((repos) => repos.filter((r) => r.id !== repositoryId))
        toast.success(t('settings.repositories.removeSuccess', 'Repository removed'))
      } else {
        toast.error(t('settings.repositories.removeError', 'Failed to remove repository'))
      }
    } catch (error) {
      console.error('Failed to remove repository:', error)
      toast.error(t('settings.repositories.removeError', 'Failed to remove repository'))
    }
  }

  const parseGitHubUrl = (url: string) => {
    try {
      let match = url.match(
        /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+))?(?:\/.*)?$/
      )
      if (!match) {
        match = url.match(/github\.com[:/]([^/]+)\/([^/\s]+)/)
      }

      if (match) {
        const owner = match[1]
        const repo = match[2].replace(/\.git$/, '')
        const branch = match[3] || 'main'

        return {
          owner,
          repo,
          branch,
          name: `${owner}/${repo}`
        }
      }
    } catch (error) {
      console.error('Failed to parse GitHub URL:', error)
    }
    return null
  }

  const handleUrlChange = (url: string) => {
    setRepoUrl(url)

    const parsed = parseGitHubUrl(url)
    if (parsed) {
      setNewRepo((prev) => ({
        ...prev,
        name: parsed.name,
        owner: parsed.owner,
        repo: parsed.repo,
        branch: parsed.branch
      }))
    }
  }

  const handleAddRepository = async () => {
    if (!newRepo.name || !newRepo.owner || !newRepo.repo) {
      toast.error(t('settings.repositories.fillAllFields', 'Please fill in all required fields'))
      return
    }

    try {
      setAddingRepo(true)

      const result = await window.api.repositoryAdd({
        name: newRepo.name,
        owner: newRepo.owner,
        repo: newRepo.repo,
        branch: newRepo.branch || 'main',
        skinsPath: newRepo.skinsPath || 'skins'
      })

      if (result.success && result.data) {
        setRepositories([...repositories, result.data])
        setShowAddDialog(false)
        setNewRepo({ name: '', owner: '', repo: '', branch: 'main', skinsPath: 'skins' })
        setRepoUrl('')

        toast.success(t('settings.repositories.addSuccess', 'Repository added successfully'))
        handleValidate(result.data.id)
      } else {
        toast.error(result.error || t('settings.repositories.addError', 'Failed to add repository'))
      }
    } catch (error) {
      console.error('Failed to add repository:', error)
      toast.error(
        `Failed to add repository: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      setAddingRepo(false)
    }
  }

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'active':
        return (
          <div
            className="flex items-center gap-1"
            title={t('settings.repositories.status.valid', 'Valid')}
          >
            <Check className="w-4 h-4 text-green-500" />
            <span className="text-xs text-green-500">
              {t('settings.repositories.status.valid', 'Valid')}
            </span>
          </div>
        )
      case 'error':
        return (
          <div
            className="flex items-center gap-1"
            title={t('settings.repositories.status.error', 'Error')}
          >
            <X className="w-4 h-4 text-red-500" />
            <span className="text-xs text-red-500">
              {t('settings.repositories.status.error', 'Error')}
            </span>
          </div>
        )
      case 'checking':
        return (
          <div
            className="flex items-center gap-1"
            title={t('settings.repositories.status.checking', 'Checking...')}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs text-text-muted">
              {t('settings.repositories.status.checking', 'Checking...')}
            </span>
          </div>
        )
      default:
        return (
          <div
            className="flex items-center gap-1"
            title={t('settings.repositories.status.unchecked', 'Unchecked')}
          >
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-yellow-500">
              {t('settings.repositories.status.unchecked', 'Unchecked')}
            </span>
          </div>
        )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            {t('settings.repositories.title', 'Skin Repositories')}
          </h3>
          <p className="text-xs text-text-secondary mt-1">
            {t(
              'settings.repositories.description',
              'Manage GitHub repositories used as skin sources'
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDialog(true)}
          disabled={disabled}
          className="flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('settings.repositories.addCustom', 'Add Repository')}
        </Button>
      </div>

      <div className="text-xs text-text-muted space-y-1 p-2 bg-surface/30 rounded-lg">
        <div className="flex items-center gap-2">
          <Check className="w-3 h-3 text-green-500" />
          <span>
            {t('settings.repositories.statusHelp.valid', 'Repository is accessible and valid')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <X className="w-3 h-3 text-red-500" />
          <span>{t('settings.repositories.statusHelp.error', 'Repository is not accessible')}</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3 h-3 text-yellow-500" />
          <span>
            {t('settings.repositories.statusHelp.unchecked', 'Repository has not been checked yet')}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {repositories.map((repo) => (
          <div
            key={repo.id}
            className={`p-3 rounded-lg border ${
              repo.id === activeRepositoryId
                ? 'border-primary bg-primary/5'
                : 'border-border bg-surface/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Github className="w-4 h-4 text-text-muted" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{repo.name}</span>
                    {repo.isDefault && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {t('settings.repositories.default', 'Default')}
                      </span>
                    )}
                    {repo.id === activeRepositoryId && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
                        {t('settings.repositories.active', 'Active')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-text-secondary">
                      {repo.owner}/{repo.repo}
                    </span>
                    <span className="text-xs text-text-muted">•</span>
                    <span className="text-xs text-text-muted">{repo.branch}</span>
                  </div>
                  <div className="mt-1">{getStatusIcon(repo.status)}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {repo.id !== activeRepositoryId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSetActive(repo.id)}
                    disabled={disabled}
                  >
                    {t('settings.repositories.setActive', 'Set Active')}
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleValidate(repo.id)}
                  disabled={disabled || validating === repo.id}
                  className="p-1"
                  title="Validate repository"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${validating === repo.id ? 'animate-spin' : ''}`}
                  />
                </Button>

                {!repo.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemove(repo.id)}
                    disabled={disabled || repo.id === activeRepositoryId}
                    className="p-1 text-destructive hover:text-destructive"
                    title={
                      repo.id === activeRepositoryId
                        ? t(
                            'settings.repositories.cannotRemoveActive',
                            'Cannot remove the active repository'
                          )
                        : undefined
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('settings.repositories.addDialog.title', 'Add Custom Repository')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.repositories.addDialog.description',
                'Add a GitHub repository containing League of Legends skins'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-url">
                {t('settings.repositories.addDialog.url', 'GitHub URL')}
              </Label>
              <Input
                id="repo-url"
                value={repoUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://github.com/owner/repository"
                disabled={addingRepo}
              />
              <p className="text-xs text-text-secondary">
                {t(
                  'settings.repositories.addDialog.urlHint',
                  'Paste a GitHub URL to auto-fill the fields below'
                )}
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-text-muted">
                  {t('settings.repositories.addDialog.or', 'or')}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-name">
                {t('settings.repositories.addDialog.name', 'Display Name')}
              </Label>
              <Input
                id="repo-name"
                value={newRepo.name}
                onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
                placeholder="My Custom Repository"
                disabled={addingRepo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-owner">
                {t('settings.repositories.addDialog.owner', 'Owner')}
              </Label>
              <Input
                id="repo-owner"
                value={newRepo.owner}
                onChange={(e) => setNewRepo({ ...newRepo, owner: e.target.value })}
                placeholder="username"
                disabled={addingRepo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-name-field">
                {t('settings.repositories.addDialog.repository', 'Repository')}
              </Label>
              <Input
                id="repo-name-field"
                value={newRepo.repo}
                onChange={(e) => setNewRepo({ ...newRepo, repo: e.target.value })}
                placeholder="lol-skins"
                disabled={addingRepo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-branch">
                {t('settings.repositories.addDialog.branch', 'Branch')}
              </Label>
              <Input
                id="repo-branch"
                value={newRepo.branch}
                onChange={(e) => setNewRepo({ ...newRepo, branch: e.target.value })}
                placeholder="main"
                disabled={addingRepo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-skins-path">
                {t('settings.repositories.addDialog.skinsPath', 'Skins Path')}
              </Label>
              <Input
                id="repo-skins-path"
                value={newRepo.skinsPath}
                onChange={(e) => setNewRepo({ ...newRepo, skinsPath: e.target.value })}
                placeholder="skins"
                disabled={addingRepo}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddDialog(false)
                setRepoUrl('')
                setNewRepo({ name: '', owner: '', repo: '', branch: 'main', skinsPath: 'skins' })
              }}
              disabled={addingRepo}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleAddRepository} disabled={addingRepo}>
              {addingRepo ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('settings.repositories.addDialog.adding', 'Adding...')}
                </>
              ) : (
                t('settings.repositories.addDialog.add', 'Add Repository')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
