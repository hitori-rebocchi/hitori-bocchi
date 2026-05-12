/**
 * Smoke test: parse → serialize → compare for skin{0..N}.bin chunks of Zoe WAD.
 *
 * Run: bunx tsx scripts/test-bin-parser.ts <path-to-Zoe.wad.client>
 *      (or: npx tsx scripts/test-bin-parser.ts ...)
 *
 * Exits 0 if all sampled bins round-trip byte-identical.
 */
import * as fs from 'fs/promises'
import { Buffer } from 'buffer'
import { XXHash64 } from 'xxhash-addon'
import { WADParser } from '../src/main/services/wadParser'
import { parseBin, serializeBin, validateRoundtrip } from '../src/main/services/binParser'
import { listSkinsForChampion } from '../src/main/services/localSkinMetadataService'

const ZERO_SEED = Buffer.alloc(8)

function xxh64Path(p: string): bigint {
  const h = new XXHash64(ZERO_SEED)
  h.update(Buffer.from(p.toLowerCase()))
  return h.digest().readBigUInt64BE(0)
}

async function main() {
  const wadPath = process.argv[2]
  if (!wadPath) {
    console.error('usage: tsx scripts/test-bin-parser.ts <Zoe.wad.client>')
    process.exit(1)
  }
  const champLc = wadPath
    .toLowerCase()
    .split(/[\\/]/)
    .pop()!
    .replace(/\.wad\.client$/, '')

  console.log(`Reading ${wadPath} ...`)
  const buf = await fs.readFile(wadPath)
  const parser = new WADParser(buf)
  const header = parser.parseHeader()
  const chunks = parser.parseChunks(header)
  console.log(`  ${chunks.length} chunks; format v${header.versionMajor}.${header.versionMinor}`)

  const byHash = new Map<bigint, (typeof chunks)[number]>()
  for (const c of chunks) byHash.set(BigInt('0x' + c.hash), c)

  let tested = 0
  let failed = 0
  for (let n = 0; n < 100; n++) {
    const path = `data/characters/${champLc}/skins/skin${n}.bin`
    const c = byHash.get(xxh64Path(path))
    if (!c) continue
    const data = parser.extractChunk(c)
    try {
      validateRoundtrip(data)
      const bf = parseBin(data)
      const reser = serializeBin(bf)
      console.log(`  skin${n}.bin: ${data.length} bytes, ${bf.entries.length} entries — OK`)
      if (reser.length !== data.length) {
        console.error(`  size diff: ${reser.length} vs ${data.length}`)
        failed++
      }
    } catch (e) {
      console.error(`  skin${n}.bin: FAIL — ${e instanceof Error ? e.message : e}`)
      failed++
    }
    tested++
  }
  console.log(`\n${tested - failed}/${tested} round-trip OK`)

  console.log(`\nMetadata listing:`)
  const skins = await listSkinsForChampion(wadPath)
  for (const s of skins.slice(0, 25)) {
    const tag = s.isChromaOf !== null ? ` (chroma of ${s.isChromaOf})` : ''
    console.log(
      `  skin${s.skinNumber}: "${s.shortName}" / "${s.friendlyName}" — line=${s.skinline}${tag}`
    )
  }
  if (skins.length > 25) console.log(`  … +${skins.length - 25} more`)

  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
