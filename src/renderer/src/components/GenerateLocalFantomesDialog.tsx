import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Progress } from './ui/progress'
import { Switch } from './ui/switch'
import { Download, FolderOpen, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'

interface ChampionEntry {
  name: string
  wadPath: string
}

interface SkinEntry {
  skinNumber: number
  internalName: string
  skinline: string
  skinlineFull: string
  skinlineAbbr: string
  friendlyName: string
  shortName: string
  loadscreen: string | null
  isChromaOf: number | null
}

interface ProgressEvent {
  current: number
  total: number
  skinNumber: number
  message: string
  success: boolean | null
}

interface GenerateLocalFantomesDialogProps {
  open: boolean
  onClose: () => void
  defaultLeagueDir?: string
}

export const GenerateLocalFantomesDialog: React.FC<GenerateLocalFantomesDialogProps> = ({
  open,
  onClose,
  defaultLeagueDir
}) => {
  const [leagueDir, setLeagueDir] = useState(defaultLeagueDir ?? 'C:/Riot Games/League of Legends')
  const [author, setAuthor] = useState('')
  const [hashtableReady, setHashtableReady] = useState<boolean | null>(null)
  const [hashtableDownloading, setHashtableDownloading] = useState(false)
  const [hashtableProgress, setHashtableProgress] = useState(0)
  const [champions, setChampions] = useState<ChampionEntry[]>([])
  const [championFilter, setChampionFilter] = useState('')
  const [selectedChampion, setSelectedChampion] = useState<ChampionEntry | null>(null)
  const [skins, setSkins] = useState<SkinEntry[]>([])
  const [selectedSkins, setSelectedSkins] = useState<Set<number>>(new Set())
  const [includeChromas, setIncludeChromas] = useState(false)
  const [loadingChampions, setLoadingChampions] = useState(false)
  const [loadingSkins, setLoadingSkins] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [log, setLog] = useState<string[]>([])

  const logScrollRef = useRef<HTMLDivElement>(null)

  // Hashtable status check + persistent prefs hydration.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const status = await window.api.localFantomeHashtableStatus()
        if (!cancelled && status?.success) setHashtableReady(!!status.exists)
      } catch {
        if (!cancelled) setHashtableReady(false)
      }
      try {
        const settings = await window.api.getSettings()
        if (cancelled) return
        const s = settings as Record<string, unknown> | undefined
        if (s?.localFantomeAuthor) setAuthor(s.localFantomeAuthor as string)
        if (s?.localFantomeLeagueDir) setLeagueDir(s.localFantomeLeagueDir as string)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Persist input changes.
  useEffect(() => {
    if (!open) return
    window.api.setSettings?.('localFantomeAuthor', author)
  }, [author, open])
  useEffect(() => {
    if (!open) return
    window.api.setSettings?.('localFantomeLeagueDir', leagueDir)
  }, [leagueDir, open])

  // Subscribe to progress events while open.
  useEffect(() => {
    if (!open) return
    const offProgress = window.api.onLocalFantomeProgress((p) => {
      setProgress(p)
      if (p.success !== null) {
        setLog((l) =>
          [
            ...l.slice(-200),
            p.success
              ? `[OK ${p.current}/${p.total}] ${p.message}`
              : `[ERR ${p.current}/${p.total}] ${p.message}`
          ].slice(-200)
        )
      } else {
        setLog((l) => [...l.slice(-200), `[${p.current}/${p.total}] ${p.message}`].slice(-200))
      }
    })
    const offHash = window.api.onLocalFantomeHashtableProgress((p) => {
      setHashtableProgress(p.percent)
    })
    return () => {
      offProgress?.()
      offHash?.()
    }
  }, [open])

  // Auto-scroll log to bottom on new entries.
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [log])

  const downloadHashtable = useCallback(async () => {
    setHashtableDownloading(true)
    setHashtableProgress(0)
    try {
      const res = await window.api.localFantomeHashtableDownload()
      if (res?.success) setHashtableReady(true)
    } finally {
      setHashtableDownloading(false)
    }
  }, [])

  const browseLeagueDir = useCallback(async () => {
    const result = await window.api.browseGameFolder?.()
    if (result && typeof result === 'string') setLeagueDir(result)
  }, [])

  const loadChampions = useCallback(async () => {
    setLoadingChampions(true)
    setSelectedChampion(null)
    setSkins([])
    setSelectedSkins(new Set())
    try {
      const res = await window.api.localFantomeListChampions(leagueDir)
      if (res?.success) setChampions(res.champions ?? [])
      else setLog((l) => [...l, `Error: ${res?.error ?? 'list-champions failed'}`])
    } catch (e) {
      setLog((l) => [...l, `Error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setLoadingChampions(false)
    }
  }, [leagueDir])

  const pickChampion = useCallback(async (c: ChampionEntry) => {
    setSelectedChampion(c)
    setSelectedSkins(new Set())
    setLoadingSkins(true)
    try {
      const res = await window.api.localFantomeListSkins(c.wadPath)
      if (res?.success) setSkins(res.skins ?? [])
      else setLog((l) => [...l, `Error: ${res?.error ?? 'list-skins failed'}`])
    } catch (e) {
      setLog((l) => [...l, `Error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setLoadingSkins(false)
    }
  }, [])

  const visibleChampions = useMemo(() => {
    const q = championFilter.trim().toLowerCase()
    if (!q) return champions
    return champions.filter((c) => c.name.toLowerCase().includes(q))
  }, [champions, championFilter])

  const displayedSkins = useMemo(() => {
    return skins.filter((s) => {
      if (s.skinNumber === 0) return false
      if (!includeChromas && s.isChromaOf !== null) return false
      return true
    })
  }, [skins, includeChromas])

  const toggleSkin = (n: number): void => {
    setSelectedSkins((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const toggleAll = (): void => {
    if (selectedSkins.size === displayedSkins.length) setSelectedSkins(new Set())
    else setSelectedSkins(new Set(displayedSkins.map((s) => s.skinNumber)))
  }

  const startGenerate = useCallback(async () => {
    if (!selectedChampion || selectedSkins.size === 0 || !author.trim()) return
    setGenerating(true)
    setLog([])
    setProgress(null)
    const items = [...selectedSkins]
      .sort((a, b) => a - b)
      .map((n) => {
        const s = skins.find((x) => x.skinNumber === n)!
        return { skinNumber: n, fileLabel: s.shortName, displayName: s.friendlyName }
      })
    try {
      const res = await window.api.localFantomeGenerate({
        wadPath: selectedChampion.wadPath,
        champion: selectedChampion.name,
        items,
        // outputDir is overridden by the main process — fantomes always land in
        // bocchi's mod-files directory so the patcher and skin picker pick them up.
        outputDir: '',
        author: author.trim()
      })
      if (res?.success) {
        const count = res.written?.length ?? 0
        setLog((l) => [...l, `--- Done. Wrote ${count} fantome(s) to your library. ---`])
      } else {
        setLog((l) => [...l, `Error: ${res?.error ?? 'unknown'}`])
      }
    } catch (e) {
      setLog((l) => [...l, `Error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setGenerating(false)
    }
  }, [selectedChampion, selectedSkins, author, skins])

  const canGenerate =
    !generating &&
    !!selectedChampion &&
    selectedSkins.size > 0 &&
    author.trim().length > 0 &&
    hashtableReady === true

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Generate skins from your local WAD
          </DialogTitle>
          <DialogDescription>
            Reads your local League installation and emits .fantome files. No Riot assets are
            bundled with the app.
          </DialogDescription>
        </DialogHeader>

        {/* Hashtable banner */}
        {hashtableReady === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-md p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 text-yellow-500" />
                <div>
                  <div className="font-medium">Hashtable not downloaded</div>
                  <div className="text-text-secondary">
                    The first run downloads the CommunityDragon hashtable (~200MB). Stored once,
                    refreshed daily.
                  </div>
                  {hashtableDownloading && (
                    <Progress value={hashtableProgress} className="mt-2 h-1.5" />
                  )}
                </div>
              </div>
              <Button onClick={downloadHashtable} disabled={hashtableDownloading} size="sm">
                {hashtableDownloading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {hashtableProgress}%
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Download
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-4 flex-1 overflow-hidden">
          {/* Left column: paths + champions */}
          <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
            <div>
              <Label className="text-xs">League directory</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={leagueDir}
                  onChange={(e) => setLeagueDir(e.target.value)}
                  placeholder="C:/Riot Games/League of Legends"
                  className="text-xs"
                />
                <Button variant="outline" size="sm" onClick={browseLeagueDir}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Output</Label>
              <div className="text-xs text-text-secondary mt-1 bg-secondary-900/40 rounded px-2 py-1.5">
                Saved into your bocchi library automatically.
              </div>
            </div>
            <Button onClick={loadChampions} disabled={loadingChampions}>
              {loadingChampions && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              Load champions
            </Button>
            {champions.length > 0 && (
              <>
                <Input
                  placeholder="Search…"
                  value={championFilter}
                  onChange={(e) => setChampionFilter(e.target.value)}
                  className="text-xs"
                />
                <div className="flex-1 overflow-y-auto border border-border rounded-md">
                  {visibleChampions.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => pickChampion(c)}
                      className={
                        'w-full text-left px-3 py-1.5 text-sm border-b border-border/40 hover:bg-surface-hover ' +
                        (selectedChampion?.name === c.name ? 'bg-accent/20 text-accent' : '')
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Middle column: skin list */}
          <div className="col-span-5 flex flex-col gap-2 overflow-hidden">
            {!selectedChampion ? (
              <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
                Pick a champion to list skins.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium">{selectedChampion.name}</span>
                    <span className="text-text-secondary ml-2">
                      {displayedSkins.length} skin(s)
                      {selectedSkins.size > 0 && ` · ${selectedSkins.size} selected`}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selectedSkins.size === displayedSkins.length ? 'Deselect all' : 'Select all'}
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={includeChromas} onCheckedChange={setIncludeChromas} />
                  Show chromas
                </label>
                {loadingSkins ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-text-secondary">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Reading WAD…
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto border border-border rounded-md">
                    {displayedSkins.map((s) => {
                      const checked = selectedSkins.has(s.skinNumber)
                      return (
                        <label
                          key={s.skinNumber}
                          className={
                            'flex items-start gap-2 px-3 py-1.5 text-sm border-b border-border/40 cursor-pointer hover:bg-surface-hover ' +
                            (checked ? 'bg-accent/10' : '') +
                            (s.isChromaOf !== null ? ' opacity-70' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSkin(s.skinNumber)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{s.shortName}</div>
                            <div className="truncate text-xs text-text-secondary">
                              {s.friendlyName} · skin{s.skinNumber}
                              {s.isChromaOf !== null && ' · chroma'}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right column: author + generate + log */}
          <div className="col-span-3 flex flex-col gap-3 overflow-hidden">
            <div>
              <Label className="text-xs">Author (written to META/info.json)</Label>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name"
                className="text-xs mt-1"
              />
            </div>
            <Button onClick={startGenerate} disabled={!canGenerate}>
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-2" />
                  Generate {selectedSkins.size || ''}{' '}
                  {selectedSkins.size === 1 ? 'fantome' : 'fantomes'}
                </>
              )}
            </Button>
            {progress && progress.total > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-text-secondary">
                  {progress.current}/{progress.total} · skin{progress.skinNumber}
                </div>
                <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
              </div>
            )}
            <div className="text-xs">
              <Label className="text-xs">Log</Label>
              <div
                ref={logScrollRef}
                className="mt-1 h-48 overflow-y-auto bg-surface-secondary rounded border border-border p-2 font-mono text-[10px] leading-tight"
              >
                {log.length === 0 ? (
                  <div className="text-text-secondary">(empty)</div>
                ) : (
                  log.map((line, i) => {
                    const isErr = line.includes('[ERR') || line.startsWith('[stderr]')
                    const isOk = line.includes('[OK')
                    return (
                      <div
                        key={i}
                        className={
                          isErr ? 'text-red-400' : isOk ? 'text-green-400' : 'text-text-secondary'
                        }
                      >
                        {isOk && <CheckCircle2 className="inline w-2.5 h-2.5 mr-1" />}
                        {isErr && <AlertCircle className="inline w-2.5 h-2.5 mr-1" />}
                        {line}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
