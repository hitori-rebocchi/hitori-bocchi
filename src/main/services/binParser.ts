/**
 * Riot BIN format parser/serializer (PROP/PTCH).
 *
 * Round-trip byte-identical for valid v3 inputs (validated via parse → serialize → equals).
 * Supports the full type set used by League skin .bin files.
 */

import { Buffer } from 'buffer'

export const BinType = {
  NONE: 0,
  BOOLB: 1,
  SInt8: 2,
  UInt8: 3,
  SInt16: 4,
  UInt16: 5,
  SInt32: 6,
  UInt32: 7,
  SInt64: 8,
  UInt64: 9,
  Float32: 10,
  VEC2: 11,
  VEC3: 12,
  VEC4: 13,
  MTX44: 14,
  RGBA: 15,
  STRING: 16,
  HASH: 17,
  WADENTRYLINK: 18,
  CONTAINER: 19,
  STRUCT: 20,
  POINTER: 21,
  EMBEDDED: 22,
  LINK: 23,
  OPTION: 24,
  MAP: 25,
  FLAG: 26
} as const

const PRIM_SIZE: Record<number, number> = {
  [BinType.NONE]: 0,
  [BinType.BOOLB]: 1,
  [BinType.SInt8]: 1,
  [BinType.UInt8]: 1,
  [BinType.SInt16]: 2,
  [BinType.UInt16]: 2,
  [BinType.SInt32]: 4,
  [BinType.UInt32]: 4,
  [BinType.SInt64]: 8,
  [BinType.UInt64]: 8,
  [BinType.Float32]: 4,
  [BinType.VEC2]: 8,
  [BinType.VEC3]: 12,
  [BinType.VEC4]: 16,
  [BinType.MTX44]: 64,
  [BinType.RGBA]: 4,
  [BinType.HASH]: 4,
  [BinType.WADENTRYLINK]: 8,
  [BinType.LINK]: 4,
  [BinType.FLAG]: 1
}

function isPrim(t: number): boolean {
  return t in PRIM_SIZE
}

/** Encode a BinType to its wire byte. Complex types (>= CONTAINER) get the high bit set. */
function encodeType(t: number): number {
  if (t >= BinType.CONTAINER) return 0x80 | (t - BinType.CONTAINER)
  return t
}

function decodeType(b: number): number {
  return b & 0x80 ? BinType.CONTAINER + (b - 0x80) : b
}

export interface BinValue {
  type: number
  /** Primitives (numeric / VEC / MTX / RGBA / HASH / WADENTRYLINK / LINK / FLAG / BOOLB). Stored as raw bytes — never interpreted. */
  rawBytes?: Buffer
  /** STRING payload (utf-8 or arbitrary bytes). */
  string?: Buffer
  /** CONTAINER / STRUCT / OPTION / MAP element type. */
  valueType?: number
  /** CONTAINER / STRUCT / OPTION items. */
  items?: BinValue[]
  /** POINTER / EMBEDDED struct name hash. 0 = null. */
  name?: number
  /** POINTER / EMBEDDED fields, when name != 0. */
  fields?: Array<[number, BinValue]>
  /** MAP key type. */
  keyType?: number
  /** MAP entries. */
  mapItems?: Array<[BinValue, BinValue]>
}

export interface BinEntry {
  typeHash: number
  keyHash: number
  fields: Array<[number, BinValue]>
}

export interface BinFile {
  isPatch: boolean
  patchUnknown: bigint
  version: number
  linkedFiles: Buffer[]
  entries: BinEntry[]
}

class BinReader {
  pos = 0
  constructor(private data: Buffer) {}

  read(n: number): Buffer {
    const b = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }

  u8(): number {
    const v = this.data.readUInt8(this.pos)
    this.pos += 1
    return v
  }

  u16(): number {
    const v = this.data.readUInt16LE(this.pos)
    this.pos += 2
    return v
  }

  u32(): number {
    const v = this.data.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  u64(): bigint {
    const v = this.data.readBigUInt64LE(this.pos)
    this.pos += 8
    return v
  }

  readValue(t: number): BinValue {
    const v: BinValue = { type: t }
    if (t === BinType.NONE) return v
    if (t === BinType.STRING) {
      const slen = this.u16()
      v.string = Buffer.from(this.read(slen))
      return v
    }
    if (isPrim(t)) {
      v.rawBytes = Buffer.from(this.read(PRIM_SIZE[t]))
      return v
    }
    if (t === BinType.CONTAINER || t === BinType.STRUCT) {
      const vt = decodeType(this.u8())
      v.valueType = vt
      this.u32() // _size
      const fc = this.u32()
      v.items = []
      for (let i = 0; i < fc; i++) v.items.push(this.readValue(vt))
      return v
    }
    if (t === BinType.POINTER || t === BinType.EMBEDDED) {
      const name = this.u32()
      v.name = name
      if (name === 0) return v
      this.u32() // _size
      const fc = this.u16()
      v.fields = []
      for (let i = 0; i < fc; i++) {
        const fname = this.u32()
        const ft = decodeType(this.u8())
        v.fields.push([fname, this.readValue(ft)])
      }
      return v
    }
    if (t === BinType.OPTION) {
      const vt = decodeType(this.u8())
      v.valueType = vt
      const fc = this.u8()
      v.items = []
      for (let i = 0; i < fc; i++) v.items.push(this.readValue(vt))
      return v
    }
    if (t === BinType.MAP) {
      const kt = decodeType(this.u8())
      const vt = decodeType(this.u8())
      v.keyType = kt
      v.valueType = vt
      this.u32() // _size
      const fc = this.u32()
      v.mapItems = []
      for (let i = 0; i < fc; i++) {
        const k = this.readValue(kt)
        const val = this.readValue(vt)
        v.mapItems.push([k, val])
      }
      return v
    }
    throw new Error(`Unknown BIN type ${t} at offset ${this.pos}`)
  }
}

export function parseBin(data: Buffer): BinFile {
  const r = new BinReader(data)
  const bf: BinFile = {
    isPatch: false,
    patchUnknown: 0n,
    version: 0,
    linkedFiles: [],
    entries: []
  }
  let magic = r.read(4).toString('ascii')
  if (magic === 'PTCH') {
    bf.isPatch = true
    bf.patchUnknown = r.u64()
    magic = r.read(4).toString('ascii')
  }
  if (magic !== 'PROP') throw new Error(`Bad BIN magic: ${magic}`)
  bf.version = r.u32()
  if (bf.version >= 2) {
    const lc = r.u32()
    for (let i = 0; i < lc; i++) {
      const slen = r.u16()
      bf.linkedFiles.push(Buffer.from(r.read(slen)))
    }
  }
  const ec = r.u32()
  const typeHashes: number[] = []
  for (let i = 0; i < ec; i++) typeHashes.push(r.u32())
  for (let i = 0; i < ec; i++) {
    const elen = r.u32()
    const end = r.pos + elen
    const key = r.u32()
    const fc = r.u16()
    const entry: BinEntry = { typeHash: typeHashes[i], keyHash: key, fields: [] }
    for (let j = 0; j < fc; j++) {
      const fname = r.u32()
      const ft = decodeType(r.u8())
      entry.fields.push([fname, r.readValue(ft)])
    }
    if (r.pos !== end)
      throw new Error(`Entry size mismatch (entry ${i}): expected end ${end}, got ${r.pos}`)
    bf.entries.push(entry)
  }
  return bf
}

function valueSize(v: BinValue): number {
  const t = v.type
  if (t === BinType.NONE) return 0
  if (t === BinType.STRING) return 2 + (v.string?.length ?? 0)
  if (isPrim(t)) return PRIM_SIZE[t]
  if (t === BinType.CONTAINER || t === BinType.STRUCT) {
    let s = 1 + 4 + 4
    for (const it of v.items!) s += valueSize(it)
    return s
  }
  if (t === BinType.POINTER || t === BinType.EMBEDDED) {
    if ((v.name ?? 0) === 0) return 4
    let body = 4 + 2
    for (const [, fv] of v.fields!) body += 4 + 1 + valueSize(fv)
    return 4 + body
  }
  if (t === BinType.OPTION) {
    let s = 1 + 1
    for (const it of v.items!) s += valueSize(it)
    return s
  }
  if (t === BinType.MAP) {
    let body = 1 + 1 + 4 + 4
    for (const [k, val] of v.mapItems!) body += valueSize(k) + valueSize(val)
    return body
  }
  throw new Error(`Unknown BIN type ${t}`)
}

class BinWriter {
  private chunks: Buffer[] = []
  private len = 0

  push(b: Buffer) {
    this.chunks.push(b)
    this.len += b.length
  }

  u8(v: number) {
    const b = Buffer.allocUnsafe(1)
    b.writeUInt8(v, 0)
    this.push(b)
  }

  u16(v: number) {
    const b = Buffer.allocUnsafe(2)
    b.writeUInt16LE(v, 0)
    this.push(b)
  }

  u32(v: number) {
    const b = Buffer.allocUnsafe(4)
    b.writeUInt32LE(v, 0)
    this.push(b)
  }

  u64(v: bigint) {
    const b = Buffer.allocUnsafe(8)
    b.writeBigUInt64LE(v, 0)
    this.push(b)
  }

  ascii(s: string) {
    this.push(Buffer.from(s, 'ascii'))
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.len)
  }
}

function writeValue(w: BinWriter, v: BinValue) {
  const t = v.type
  if (t === BinType.NONE) return
  if (t === BinType.STRING) {
    const s = v.string ?? Buffer.alloc(0)
    w.u16(s.length)
    w.push(s)
    return
  }
  if (isPrim(t)) {
    const raw = v.rawBytes!
    if (raw.length !== PRIM_SIZE[t])
      throw new Error(`Primitive size mismatch type=${t}: ${raw.length} vs ${PRIM_SIZE[t]}`)
    w.push(raw)
    return
  }
  if (t === BinType.CONTAINER || t === BinType.STRUCT) {
    w.u8(encodeType(v.valueType!))
    let inner = 4
    for (const it of v.items!) inner += valueSize(it)
    w.u32(inner)
    w.u32(v.items!.length)
    for (const it of v.items!) writeValue(w, it)
    return
  }
  if (t === BinType.POINTER || t === BinType.EMBEDDED) {
    w.u32(v.name ?? 0)
    if ((v.name ?? 0) === 0) return
    let inner = 2
    for (const [, fv] of v.fields!) inner += 4 + 1 + valueSize(fv)
    w.u32(inner)
    w.u16(v.fields!.length)
    for (const [fname, fv] of v.fields!) {
      w.u32(fname)
      w.u8(encodeType(fv.type))
      writeValue(w, fv)
    }
    return
  }
  if (t === BinType.OPTION) {
    w.u8(encodeType(v.valueType!))
    w.u8(v.items!.length)
    for (const it of v.items!) writeValue(w, it)
    return
  }
  if (t === BinType.MAP) {
    w.u8(encodeType(v.keyType!))
    w.u8(encodeType(v.valueType!))
    let inner = 4
    for (const [k, val] of v.mapItems!) inner += valueSize(k) + valueSize(val)
    w.u32(inner)
    w.u32(v.mapItems!.length)
    for (const [k, val] of v.mapItems!) {
      writeValue(w, k)
      writeValue(w, val)
    }
    return
  }
  throw new Error(`Unknown BIN type ${t}`)
}

export function serializeBin(bf: BinFile): Buffer {
  const w = new BinWriter()
  if (bf.isPatch) {
    w.ascii('PTCH')
    w.u64(bf.patchUnknown)
  }
  w.ascii('PROP')
  w.u32(bf.version)
  if (bf.version >= 2) {
    w.u32(bf.linkedFiles.length)
    for (const lf of bf.linkedFiles) {
      w.u16(lf.length)
      w.push(lf)
    }
  }
  w.u32(bf.entries.length)
  for (const e of bf.entries) w.u32(e.typeHash)
  for (const e of bf.entries) {
    let body = 4 + 2
    for (const [, fv] of e.fields) body += 4 + 1 + valueSize(fv)
    w.u32(body)
    w.u32(e.keyHash)
    w.u16(e.fields.length)
    for (const [fname, fv] of e.fields) {
      w.u32(fname)
      w.u8(encodeType(fv.type))
      writeValue(w, fv)
    }
  }
  return w.toBuffer()
}

/** Verify parse → serialize is byte-identical for the given BIN. Throws on mismatch. */
export function validateRoundtrip(data: Buffer): void {
  const bf = parseBin(data)
  const out = serializeBin(bf)
  if (out.length !== data.length)
    throw new Error(`BIN roundtrip length mismatch: ${out.length} vs ${data.length}`)
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== data[i])
      throw new Error(
        `BIN roundtrip diff at byte ${i}: orig=0x${data[i].toString(16)} new=0x${out[i].toString(16)}`
      )
  }
}

/** Find first entry of the given type hash, or null. */
export function findEntry(bf: BinFile, typeHash: number): BinEntry | null {
  return bf.entries.find((e) => e.typeHash === typeHash) ?? null
}

/** Find a field within a POINTER/EMBEDDED-style fields list, or null. */
export function findField(fields: Array<[number, BinValue]>, fieldName: number): BinValue | null {
  for (const [fn, fv] of fields) if (fn === fieldName) return fv
  return null
}
