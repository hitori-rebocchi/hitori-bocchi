/**
 * Read a champion WAD and emit per-skin metadata + human-readable names.
 *
 * Port of wad-skin-tools/tools/list_skins_metadata.py.
 *
 * Given a champion's `.wad.client`, this:
 *   1. Walks skin0..skin149 .bin chunks, parses each to extract championSkinName,
 *      metaDataTags (skinline), loadscreen, and skinMeshProperties (SKL/SKN paths).
 *   2. Detects chromas by SKL/SKN reuse — a skin re-using an earlier skin's
 *      skeleton is a chroma of that skin.
 *   3. Builds human names ("Zoe Guardiana Estelar", "Zoe GE", "Zoe GE Chroma 1")
 *      using the SKINLINE_INFO Spanish abbreviation table.
 *
 * "Local" in the service name distinguishes it from skinMetadataService.ts,
 * which manages metadata for already-imported .fantome files.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { Buffer } from 'buffer'
import { XXHash64 } from 'xxhash-addon'
import { WADParser, WADChunk } from './wadParser'
import { parseBin, BinFile, BinValue, BinType, findField } from './binParser'

const SKIN_NAME_FIELD = 0x2d78c328
const TAGS_FIELD = 0x939e7b29
const MESH_PROPS_FIELD = 0x45ff5904
const MESH_SKL_FIELD = 0xb14c976e
const MESH_SKN_FIELD = 0xd6a00df6
const LOADSCREEN_FIELD = 0x97f7188d
const LOADSCREEN_INNER_TEX = 0xb35135fa
const WRAPPER_TYPE_9B67 = 0x9b67e9f6

const ZERO_SEED = Buffer.alloc(8)

function xxh64Path(p: string): bigint {
  const h = new XXHash64(ZERO_SEED)
  h.update(Buffer.from(p.toLowerCase()))
  // xxhash-addon's digest() returns big-endian bytes; the integer value matches
  // Python's xxhash.xxh64(...).intdigest() and the value WAD chunks are keyed by.
  return h.digest().readBigUInt64BE(0)
}

const SKINLINE_INFO: Record<string, [string, string]> = {
  base: ['Base', 'B'],
  academy: ['Academia', 'ACA'],
  'anima squad': ['Anima Squad', 'AS'],
  animasquad: ['Anima Squad', 'AS'],
  arcade: ['Arcade', 'ARC'],
  arcana: ['Arcana', 'ARK'],
  arcanist: ['Arcanista', 'ARN'],
  battleboss: ['Jefe de Batalla', 'JB'],
  bilgewater: ['Bilgewater', 'BW'],
  bloodmoon: ['Luna Sangrienta', 'LS'],
  cafecuties: ['Cafe Cuties', 'CC'],
  challenger: ['Retador', 'RT'],
  chronicle: ['Crónica', 'CR'],
  coven: ['Aquelarre', 'AQ'],
  cyberpop: ['Cyberpop', 'CP'],
  darkstar: ['Estrella Oscura', 'EO'],
  dragonmancers: ['Dragomantes', 'DG'],
  dragonmaster: ['Amo de Dragones', 'AD'],
  edg: ['EDG', 'EDG'],
  elderwood: ['Bosque Ancestral', 'BA'],
  highnoon: ['Mediodía', 'MD'],
  highstakes: ['Apuestas Altas', 'AA'],
  infernal: ['Infernal', 'INF'],
  inkshadow: ['Sombra de Tinta', 'ST'],
  kda: ['K/DA', 'KDA'],
  kdaallout: ['K/DA All Out', 'KDAO'],
  kanmei: ['Kanmei', 'KAN'],
  legacy: ['Clásica', 'CLA'],
  nightbringer: ['Portador del Anochecer', 'PA'],
  odyssey: ['Odisea', 'OD'],
  otherroads: ['Otros Caminos', 'OC'],
  pentakill: ['Pentakill', 'PK'],
  petalsofspring: ['Pétalos de Primavera', 'PP'],
  poolparty: ['Fiesta en la Piscina', 'FP'],
  popstar: ['Popstar', 'PS'],
  project: ['PROJECT', 'PJ'],
  risenlegends: ['Leyendas Resucitadas', 'LR'],
  roadwarrior: ['Guerrero del Camino', 'GC'],
  ruined: ['Arruinado', 'ARR'],
  snowmoon: ['Luna de Nieve', 'LN'],
  spacegroove: ['Space Groove', 'SPG'],
  spiritblossom: ['Espíritu Florido', 'EF'],
  spiritblossomsprings: ['Espíritu Florido Primavera', 'EFP'],
  starguardian: ['Guardiana Estelar', 'GE'],
  supergalaxy: ['Súper Galáctico', 'SG'],
  theeternalaspects: ['Aspectos Eternos', 'AE'],
  thelostchapter: ['Capítulo Perdido', 'CapP'],
  truedamage: ['Daño Real', 'DR'],
  winterblessed: ['Bendición Invernal', 'BI'],
  wondersoftheworld: ['Maravillas del Mundo', 'MM']
}

function skinlineFullAndAbbr(skinline: string | null | undefined): [string, string] {
  const s = (skinline || 'base').toLowerCase().trim()
  if (s in SKINLINE_INFO) return SKINLINE_INFO[s]
  const pretty = s.replace(/\b\w/g, (c) => c.toUpperCase())
  const upperOnly = pretty.replace(/[^A-Z]/g, '').slice(0, 4)
  const abbr = upperOnly.length > 0 ? upperOnly : pretty.slice(0, 3).toUpperCase()
  return [pretty, abbr]
}

function championDisplay(internalLc: string): string {
  if (!internalLc) return ''
  return internalLc[0].toUpperCase() + internalLc.slice(1)
}

function extractSkinline(tags: string): string {
  for (const tok of tags.split(',')) {
    if (tok.toLowerCase().includes('skinline:')) {
      return tok.split(':').slice(1).join(':').trim()
    }
  }
  return 'base'
}

function readString(v: BinValue | null): string {
  if (!v || v.type !== BinType.STRING || !v.string) return ''
  return v.string.toString('utf-8')
}

export interface LocalSkinEntry {
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

/** Parse a single skin{N}.bin and return its identity row. */
function parseSkinEntry(
  bf: BinFile,
  skinNumber: number,
  sklOwners: Map<string, number>,
  sknOwners: Map<string, number>,
  prior: LocalSkinEntry[]
): Omit<LocalSkinEntry, 'friendlyName' | 'shortName' | 'skinlineFull' | 'skinlineAbbr'> | null {
  const head = bf.entries.find((e) => e.typeHash === WRAPPER_TYPE_9B67)
  if (!head) return null

  const internalName = readString(findField(head.fields, SKIN_NAME_FIELD))
  const tags = readString(findField(head.fields, TAGS_FIELD))
  const skinline = extractSkinline(tags)

  let loadscreen: string | null = null
  const lf = findField(head.fields, LOADSCREEN_FIELD)
  if (lf && (lf.type === BinType.POINTER || lf.type === BinType.EMBEDDED) && lf.fields) {
    const inner = lf.fields.find(([fn]) => fn === LOADSCREEN_INNER_TEX)
    if (inner && inner[1].type === BinType.STRING && inner[1].string) {
      loadscreen = inner[1].string.toString('utf-8')
    }
  }

  let sklPath: string | null = null
  let sknPath: string | null = null
  const mp = findField(head.fields, MESH_PROPS_FIELD)
  if (mp && (mp.type === BinType.POINTER || mp.type === BinType.EMBEDDED) && mp.fields) {
    for (const [fn, fv] of mp.fields) {
      if (fn === MESH_SKL_FIELD && fv.type === BinType.STRING && fv.string) {
        sklPath = fv.string.toString('utf-8').toLowerCase()
      } else if (fn === MESH_SKN_FIELD && fv.type === BinType.STRING && fv.string) {
        sknPath = fv.string.toString('utf-8').toLowerCase()
      }
    }
  }

  let isChromaOf: number | null = null
  if (sklPath && sklOwners.has(sklPath)) {
    isChromaOf = sklOwners.get(sklPath)!
  } else if (sknPath && sknOwners.has(sknPath)) {
    isChromaOf = sknOwners.get(sknPath)!
  } else if (internalName.toLowerCase().includes('chroma') && prior.length > 0) {
    for (let i = prior.length - 1; i >= 0; i--) {
      const p = prior[i]
      if (p.skinline === skinline && p.isChromaOf === null) {
        isChromaOf = p.skinNumber
        break
      }
    }
  }

  if (sklPath && !sklOwners.has(sklPath)) sklOwners.set(sklPath, skinNumber)
  if (sknPath && !sknOwners.has(sknPath)) sknOwners.set(sknPath, skinNumber)

  return { skinNumber, internalName, skinline, loadscreen, isChromaOf }
}

/** Read a WAD file and return identity + human-readable names for every skin slot. */
export async function listSkinsForChampion(wadPath: string): Promise<LocalSkinEntry[]> {
  const champLc = path
    .basename(wadPath)
    .replace(/\.wad\.client$/i, '')
    .toLowerCase()
  const buffer = await fs.readFile(wadPath)
  const parser = new WADParser(buffer)
  const header = parser.parseHeader()
  const chunks = parser.parseChunks(header)
  const byHash = new Map<bigint, WADChunk>()
  for (const c of chunks) byHash.set(BigInt('0x' + c.hash), c)

  const getChunk = (p: string): Buffer | null => {
    const h = xxh64Path(p)
    const c = byHash.get(h)
    return c ? parser.extractChunk(c) : null
  }

  const sklOwners = new Map<string, number>()
  const sknOwners = new Map<string, number>()
  const partials: Array<
    Omit<LocalSkinEntry, 'friendlyName' | 'shortName' | 'skinlineFull' | 'skinlineAbbr'>
  > = []

  for (let n = 0; n < 150; n++) {
    const data = getChunk(`data/characters/${champLc}/skins/skin${n}.bin`)
    if (!data) continue
    let bf: BinFile
    try {
      bf = parseBin(data)
    } catch {
      continue
    }
    const entry = parseSkinEntry(bf, n, sklOwners, sknOwners, partials as LocalSkinEntry[])
    if (entry) partials.push(entry)
  }

  // Second pass: human names + abbrev counters.
  const champDisplay = championDisplay(champLc)
  const baseCount = new Map<string, number>()
  const baseSeen = new Map<string, number>()
  const chromaIndexByOwner = new Map<number, number>()

  for (const s of partials) {
    if (s.isChromaOf === null) baseCount.set(s.skinline, (baseCount.get(s.skinline) ?? 0) + 1)
  }

  const out: LocalSkinEntry[] = []
  for (const s of partials) {
    const [full, abbr] = skinlineFullAndAbbr(s.skinline)
    let friendlyName: string
    let shortName: string
    if (s.skinNumber === 0) {
      friendlyName = champDisplay
      shortName = champDisplay
    } else if (s.isChromaOf === null) {
      const cnt = baseCount.get(s.skinline) ?? 0
      if (cnt > 1) {
        const seen = (baseSeen.get(s.skinline) ?? 0) + 1
        baseSeen.set(s.skinline, seen)
        friendlyName = `${champDisplay} ${full} ${seen}`
        shortName = `${champDisplay} ${abbr} ${seen}`
      } else {
        baseSeen.set(s.skinline, 1)
        friendlyName = `${champDisplay} ${full}`
        shortName = `${champDisplay} ${abbr}`
      }
    } else {
      const idx = (chromaIndexByOwner.get(s.isChromaOf) ?? 0) + 1
      chromaIndexByOwner.set(s.isChromaOf, idx)
      const owner = out.find((o) => o.skinNumber === s.isChromaOf)
      const ownerShort = owner?.shortName ?? `${champDisplay} ${abbr}`
      const ownerFull = owner?.friendlyName ?? `${champDisplay} ${full}`
      friendlyName = `${ownerFull} Chroma ${idx}`
      shortName = `${ownerShort} Chroma ${idx}`
    }

    out.push({
      ...s,
      skinlineFull: full,
      skinlineAbbr: abbr,
      friendlyName,
      shortName
    })
  }

  return out
}

/** Scan a League installation's Champions/ folder and return every WAD found. */
export async function listLocalChampions(
  leagueDir: string
): Promise<Array<{ name: string; wadPath: string }>> {
  const champDir = path.join(leagueDir, 'Game', 'DATA', 'FINAL', 'Champions')
  let entries: string[]
  try {
    entries = await fs.readdir(champDir)
  } catch {
    throw new Error(`League installation not found at ${leagueDir}`)
  }
  const out: Array<{ name: string; wadPath: string }> = []
  for (const f of entries) {
    if (!f.toLowerCase().endsWith('.wad.client')) continue
    if (f.toLowerCase().includes('.tft.')) continue
    const name = f.replace(/\.wad\.client$/i, '')
    out.push({ name, wadPath: path.join(champDir, f) })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
