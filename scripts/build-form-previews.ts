/**
 * Builds resources/form-previews/ : per-form preview PNGs + manifest.json.
 *
 * Source: each gear's own in-game portrait icon (`mSelfOnlyPortraitIcon`),
 * which the sidecar surfaces via `list-forms` as `iconPath`. CommunityDragon
 * serves those .tex assets as .png, so the mapping is exact — the icon belongs
 * to that gearIndex, no ordering/permutation guesswork. Gears with no icon
 * (e.g. Viego, whose forms are named from Toggle_ events) are skipped and fall
 * back to the base skin image at runtime.
 *
 * Run:  npx tsx scripts/build-form-previews.ts
 * Env overrides (optional):
 *   LEAGUE_DIR  default "C:/Riot Games/League of Legends"
 *   SIDECAR     default native/bocchi-overlay/target/release/ltk-manager.exe
 *   ONLY        comma list "Viego:43,Ahri:86" to limit work
 */
import * as path from 'path'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import axios from 'axios'

const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(REPO_ROOT, 'resources', 'form-previews')

const LEAGUE_DIR = process.env.LEAGUE_DIR || 'C:/Riot Games/League of Legends'
const CHAMPIONS_DIR = path.join(LEAGUE_DIR, 'Game', 'DATA', 'FINAL', 'Champions')
const SIDECAR =
  process.env.SIDECAR ||
  path.join(REPO_ROOT, 'native', 'bocchi-overlay', 'target', 'release', 'ltk-manager.exe')
const CDRAGON = 'https://raw.communitydragon.org/latest/'

type Target = { championId: number; key: string; num: number }
const TARGETS: Target[] = [
  { championId: 234, key: 'Viego', num: 43 },
  { championId: 82, key: 'Mordekaiser', num: 54 },
  { championId: 103, key: 'Ahri', num: 86 },
  { championId: 145, key: 'Kaisa', num: 71 },
  { championId: 222, key: 'Jinx', num: 60 },
  { championId: 25, key: 'Morgana', num: 80 },
  { championId: 875, key: 'Sett', num: 66 }
]

// "ASSETS/Characters/Ahri/HUD/Ahri_Circle_86_Tier2.tex" ->
// "https://raw.communitydragon.org/latest/game/assets/characters/ahri/hud/ahri_circle_86_tier2.png"
function cdragonUrl(assetPath: string): string {
  let p = assetPath.replace(/\\/g, '/').toLowerCase()
  if (p.startsWith('assets/')) p = 'game/' + p
  p = p.replace(/\.(tex|dds)$/, '.png')
  return CDRAGON + p
}

function listForms(t: Target): Array<{ index: number; label: string; iconPath: string }> {
  const wadPath = path.join(CHAMPIONS_DIR, `${t.key}.wad.client`)
  if (!existsSync(wadPath)) throw new Error(`WAD not found: ${wadPath}`)
  const out = execFileSync(SIDECAR, ['list-forms', '--request-json', '-'], {
    input: JSON.stringify({ wadPath, champion: t.key, skinNumber: t.num }),
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(out.trim()).forms || []
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: (s) => s === 200
    })
    return Buffer.from(res.data)
  } catch {
    return null
  }
}

async function processTarget(t: Target): Promise<Record<string, string>> {
  console.log(`\n=== ${t.key} skin${t.num} ===`)
  const forms = listForms(t)
  const entry: Record<string, string> = {}
  const skinOutDir = path.join(OUT_ROOT, String(t.championId), String(t.num))
  await fs.mkdir(skinOutDir, { recursive: true })

  for (const f of forms) {
    if (!f.iconPath) {
      console.log(`  gear ${f.index} (${f.label || 'base'}): no icon, skipped`)
      continue
    }
    const url = cdragonUrl(f.iconPath)
    const png = await download(url)
    if (!png) {
      console.warn(`  gear ${f.index} (${f.label}): icon 404 ${url}`)
      continue
    }
    const rel = path.posix.join(String(t.championId), String(t.num), `${f.index}.png`)
    await fs.writeFile(path.join(OUT_ROOT, rel), png)
    entry[String(f.index)] = rel
    console.log(`  gear ${f.index} (${f.label}): ${png.length}b ok`)
  }
  return entry
}

async function main(): Promise<void> {
  if (!existsSync(SIDECAR)) {
    console.error(`Missing sidecar: ${SIDECAR}`)
    process.exit(1)
  }
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => s.trim())) : null
  const targets = only ? TARGETS.filter((t) => only.has(`${t.key}:${t.num}`)) : TARGETS

  await fs.mkdir(OUT_ROOT, { recursive: true })
  const manifest: Record<string, Record<string, Record<string, string>>> = {}
  for (const t of targets) {
    try {
      const entry = await processTarget(t)
      if (Object.keys(entry).length > 0) {
        manifest[String(t.championId)] ??= {}
        manifest[String(t.championId)][String(t.num)] = entry
      }
    } catch (e) {
      console.error(`FAILED ${t.key} skin${t.num}: ${(e as Error).message}`)
    }
  }

  const manifestPath = path.join(OUT_ROOT, 'manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  console.log(`\nWrote ${manifestPath}`)
  console.log(JSON.stringify(manifest, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
