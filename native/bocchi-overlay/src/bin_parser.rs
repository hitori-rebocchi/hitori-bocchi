//! Riot BIN format parser/serializer (PROP/PTCH).
//!
//! Round-trip byte-identical for valid v3 inputs. Supports the full type
//! set used by League skin .bin files.

use anyhow::{anyhow, bail, Result};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::io::{Cursor, Read};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BinType {
    None = 0,
    Bool = 1,
    SInt8 = 2,
    UInt8 = 3,
    SInt16 = 4,
    UInt16 = 5,
    SInt32 = 6,
    UInt32 = 7,
    SInt64 = 8,
    UInt64 = 9,
    Float32 = 10,
    Vec2 = 11,
    Vec3 = 12,
    Vec4 = 13,
    Mtx44 = 14,
    Rgba = 15,
    String = 16,
    Hash = 17,
    WadEntryLink = 18,
    Container = 19,
    Struct = 20,
    Pointer = 21,
    Embedded = 22,
    Link = 23,
    Option = 24,
    Map = 25,
    Flag = 26,
}

impl BinType {
    fn from_raw(raw: u8) -> Result<Self> {
        Ok(match raw {
            0 => Self::None,
            1 => Self::Bool,
            2 => Self::SInt8,
            3 => Self::UInt8,
            4 => Self::SInt16,
            5 => Self::UInt16,
            6 => Self::SInt32,
            7 => Self::UInt32,
            8 => Self::SInt64,
            9 => Self::UInt64,
            10 => Self::Float32,
            11 => Self::Vec2,
            12 => Self::Vec3,
            13 => Self::Vec4,
            14 => Self::Mtx44,
            15 => Self::Rgba,
            16 => Self::String,
            17 => Self::Hash,
            18 => Self::WadEntryLink,
            19 => Self::Container,
            20 => Self::Struct,
            21 => Self::Pointer,
            22 => Self::Embedded,
            23 => Self::Link,
            24 => Self::Option,
            25 => Self::Map,
            26 => Self::Flag,
            other => bail!("Unknown BIN type {}", other),
        })
    }

    /// Decode wire-format byte: high bit signals complex type offset from Container.
    pub fn decode(b: u8) -> Result<Self> {
        let raw = if b & 0x80 != 0 {
            (Self::Container as u8) + (b - 0x80)
        } else {
            b
        };
        Self::from_raw(raw)
    }

    /// Encode to wire-format byte.
    pub fn encode(self) -> u8 {
        let raw = self as u8;
        if raw >= (Self::Container as u8) {
            0x80 | (raw - (Self::Container as u8))
        } else {
            raw
        }
    }

    /// Byte size for primitive types. None for non-primitive (Container, Map, etc.).
    pub fn prim_size(self) -> Option<usize> {
        Some(match self {
            Self::None => 0,
            Self::Bool | Self::SInt8 | Self::UInt8 | Self::Flag => 1,
            Self::SInt16 | Self::UInt16 => 2,
            Self::SInt32 | Self::UInt32 | Self::Float32 | Self::Rgba | Self::Hash | Self::Link => 4,
            Self::SInt64 | Self::UInt64 | Self::Vec2 | Self::WadEntryLink => 8,
            Self::Vec3 => 12,
            Self::Vec4 => 16,
            Self::Mtx44 => 64,
            _ => return None,
        })
    }

    pub fn is_prim(self) -> bool {
        self.prim_size().is_some()
    }
}

/// Represents any BIN value. The variant encodes the type; the type byte is
/// derived from the variant on serialize.
#[derive(Debug, Clone)]
pub enum BinValue {
    /// Type 0 (None) — no payload.
    None,
    /// Fixed-size primitive (numeric types, VEC*, MTX44, RGBA, HASH, WADENTRYLINK,
    /// LINK, FLAG, BOOLB). Raw bytes are never interpreted — they round-trip.
    Prim { ty: BinType, raw: Vec<u8> },
    /// Type 16 (STRING) — UTF-8 or arbitrary bytes.
    String(Vec<u8>),
    /// Type 19 (CONTAINER) or 20 (STRUCT). Wire identical aside from the type byte.
    Container {
        is_struct: bool,
        value_type: BinType,
        items: Vec<BinValue>,
    },
    /// Type 21 (POINTER) or 22 (EMBEDDED). `name == 0` is a null pointer with no fields.
    PointerOrEmbedded {
        is_embedded: bool,
        name: u32,
        fields: Vec<(u32, BinValue)>,
    },
    /// Type 24 (OPTION).
    Option {
        value_type: BinType,
        items: Vec<BinValue>,
    },
    /// Type 25 (MAP).
    Map {
        key_type: BinType,
        value_type: BinType,
        items: Vec<(BinValue, BinValue)>,
    },
}

impl BinValue {
    /// Wire type of this value.
    pub fn ty(&self) -> BinType {
        match self {
            Self::None => BinType::None,
            Self::Prim { ty, .. } => *ty,
            Self::String(_) => BinType::String,
            Self::Container { is_struct, .. } => {
                if *is_struct {
                    BinType::Struct
                } else {
                    BinType::Container
                }
            }
            Self::PointerOrEmbedded { is_embedded, .. } => {
                if *is_embedded {
                    BinType::Embedded
                } else {
                    BinType::Pointer
                }
            }
            Self::Option { .. } => BinType::Option,
            Self::Map { .. } => BinType::Map,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BinEntry {
    pub type_hash: u32,
    pub key_hash: u32,
    pub fields: Vec<(u32, BinValue)>,
}

#[derive(Debug, Clone)]
pub struct BinFile {
    pub is_patch: bool,
    pub patch_unknown: u64,
    pub version: u32,
    pub linked_files: Vec<Vec<u8>>,
    pub entries: Vec<BinEntry>,
}

// ------------------------------ Reading -------------------------------------

fn read_n<R: Read>(r: &mut R, n: usize) -> Result<Vec<u8>> {
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

fn read_value<R: Read>(r: &mut R, ty: BinType) -> Result<BinValue> {
    match ty {
        BinType::None => Ok(BinValue::None),
        BinType::String => {
            let len = r.read_u16::<LittleEndian>()? as usize;
            Ok(BinValue::String(read_n(r, len)?))
        }
        BinType::Container | BinType::Struct => {
            let vt = BinType::decode(r.read_u8()?)?;
            let _size = r.read_u32::<LittleEndian>()?;
            let count = r.read_u32::<LittleEndian>()? as usize;
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                items.push(read_value(r, vt)?);
            }
            Ok(BinValue::Container {
                is_struct: ty == BinType::Struct,
                value_type: vt,
                items,
            })
        }
        BinType::Pointer | BinType::Embedded => {
            let name = r.read_u32::<LittleEndian>()?;
            if name == 0 {
                return Ok(BinValue::PointerOrEmbedded {
                    is_embedded: ty == BinType::Embedded,
                    name: 0,
                    fields: Vec::new(),
                });
            }
            let _size = r.read_u32::<LittleEndian>()?;
            let fc = r.read_u16::<LittleEndian>()? as usize;
            let mut fields = Vec::with_capacity(fc);
            for _ in 0..fc {
                let fname = r.read_u32::<LittleEndian>()?;
                let ft = BinType::decode(r.read_u8()?)?;
                fields.push((fname, read_value(r, ft)?));
            }
            Ok(BinValue::PointerOrEmbedded {
                is_embedded: ty == BinType::Embedded,
                name,
                fields,
            })
        }
        BinType::Option => {
            let vt = BinType::decode(r.read_u8()?)?;
            let count = r.read_u8()? as usize;
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                items.push(read_value(r, vt)?);
            }
            Ok(BinValue::Option {
                value_type: vt,
                items,
            })
        }
        BinType::Map => {
            let kt = BinType::decode(r.read_u8()?)?;
            let vt = BinType::decode(r.read_u8()?)?;
            let _size = r.read_u32::<LittleEndian>()?;
            let count = r.read_u32::<LittleEndian>()? as usize;
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                let k = read_value(r, kt)?;
                let v = read_value(r, vt)?;
                items.push((k, v));
            }
            Ok(BinValue::Map {
                key_type: kt,
                value_type: vt,
                items,
            })
        }
        t if t.is_prim() => {
            let sz = t.prim_size().unwrap();
            Ok(BinValue::Prim {
                ty: t,
                raw: read_n(r, sz)?,
            })
        }
        other => bail!("readValue: unhandled type {:?}", other),
    }
}

pub fn parse_bin(data: &[u8]) -> Result<BinFile> {
    let mut cur = Cursor::new(data);
    let mut bf = BinFile {
        is_patch: false,
        patch_unknown: 0,
        version: 0,
        linked_files: Vec::new(),
        entries: Vec::new(),
    };

    let mut magic = read_n(&mut cur, 4)?;
    if magic == b"PTCH" {
        bf.is_patch = true;
        bf.patch_unknown = cur.read_u64::<LittleEndian>()?;
        magic = read_n(&mut cur, 4)?;
    }
    if magic != b"PROP" {
        bail!(
            "Bad BIN magic: {:?}",
            std::str::from_utf8(&magic).unwrap_or("<non-utf8>")
        );
    }

    bf.version = cur.read_u32::<LittleEndian>()?;
    if bf.version >= 2 {
        let lc = cur.read_u32::<LittleEndian>()? as usize;
        for _ in 0..lc {
            let len = cur.read_u16::<LittleEndian>()? as usize;
            bf.linked_files.push(read_n(&mut cur, len)?);
        }
    }

    let ec = cur.read_u32::<LittleEndian>()? as usize;
    let mut type_hashes = Vec::with_capacity(ec);
    for _ in 0..ec {
        type_hashes.push(cur.read_u32::<LittleEndian>()?);
    }
    for i in 0..ec {
        let elen = cur.read_u32::<LittleEndian>()? as u64;
        let end = cur.position() + elen;
        let key = cur.read_u32::<LittleEndian>()?;
        let fc = cur.read_u16::<LittleEndian>()? as usize;
        let mut fields = Vec::with_capacity(fc);
        for _ in 0..fc {
            let fname = cur.read_u32::<LittleEndian>()?;
            let ft = BinType::decode(cur.read_u8()?)?;
            fields.push((fname, read_value(&mut cur, ft)?));
        }
        if cur.position() != end {
            bail!(
                "Entry size mismatch (entry {}): expected end {}, got {}",
                i,
                end,
                cur.position()
            );
        }
        bf.entries.push(BinEntry {
            type_hash: type_hashes[i],
            key_hash: key,
            fields,
        });
    }

    Ok(bf)
}

// ----------------------------- Sizing ---------------------------------------

fn value_size(v: &BinValue) -> Result<usize> {
    Ok(match v {
        BinValue::None => 0,
        BinValue::String(s) => 2 + s.len(),
        BinValue::Prim { ty, .. } => ty.prim_size().ok_or_else(|| anyhow!("not prim"))?,
        BinValue::Container { items, .. } => {
            let mut s = 1 + 4 + 4;
            for it in items {
                s += value_size(it)?;
            }
            s
        }
        BinValue::PointerOrEmbedded { name, fields, .. } => {
            if *name == 0 {
                4
            } else {
                let mut body = 4 + 2;
                for (_, fv) in fields {
                    body += 4 + 1 + value_size(fv)?;
                }
                4 + body
            }
        }
        BinValue::Option { items, .. } => {
            let mut s = 1 + 1;
            for it in items {
                s += value_size(it)?;
            }
            s
        }
        BinValue::Map { items, .. } => {
            let mut body = 1 + 1 + 4 + 4;
            for (k, val) in items {
                body += value_size(k)? + value_size(val)?;
            }
            body
        }
    })
}

// ---------------------------- Writing ---------------------------------------

fn write_value(out: &mut Vec<u8>, v: &BinValue) -> Result<()> {
    match v {
        BinValue::None => {}
        BinValue::String(s) => {
            out.write_u16::<LittleEndian>(s.len() as u16)?;
            out.extend_from_slice(s);
        }
        BinValue::Prim { ty, raw } => {
            let sz = ty.prim_size().ok_or_else(|| anyhow!("not prim"))?;
            if raw.len() != sz {
                bail!(
                    "Primitive size mismatch type={:?}: {} vs {}",
                    ty,
                    raw.len(),
                    sz
                );
            }
            out.extend_from_slice(raw);
        }
        BinValue::Container {
            value_type, items, ..
        } => {
            out.write_u8(value_type.encode())?;
            let mut inner: u32 = 4;
            for it in items {
                inner += value_size(it)? as u32;
            }
            out.write_u32::<LittleEndian>(inner)?;
            out.write_u32::<LittleEndian>(items.len() as u32)?;
            for it in items {
                write_value(out, it)?;
            }
        }
        BinValue::PointerOrEmbedded { name, fields, .. } => {
            out.write_u32::<LittleEndian>(*name)?;
            if *name == 0 {
                return Ok(());
            }
            let mut inner: u32 = 2;
            for (_, fv) in fields {
                inner += 4 + 1 + value_size(fv)? as u32;
            }
            out.write_u32::<LittleEndian>(inner)?;
            out.write_u16::<LittleEndian>(fields.len() as u16)?;
            for (fname, fv) in fields {
                out.write_u32::<LittleEndian>(*fname)?;
                out.write_u8(fv.ty().encode())?;
                write_value(out, fv)?;
            }
        }
        BinValue::Option {
            value_type, items, ..
        } => {
            out.write_u8(value_type.encode())?;
            out.write_u8(items.len() as u8)?;
            for it in items {
                write_value(out, it)?;
            }
        }
        BinValue::Map {
            key_type,
            value_type,
            items,
        } => {
            out.write_u8(key_type.encode())?;
            out.write_u8(value_type.encode())?;
            let mut inner: u32 = 4;
            for (k, val) in items {
                inner += (value_size(k)? + value_size(val)?) as u32;
            }
            out.write_u32::<LittleEndian>(inner)?;
            out.write_u32::<LittleEndian>(items.len() as u32)?;
            for (k, val) in items {
                write_value(out, k)?;
                write_value(out, val)?;
            }
        }
    }
    Ok(())
}

pub fn serialize_bin(bf: &BinFile) -> Result<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    if bf.is_patch {
        out.extend_from_slice(b"PTCH");
        out.write_u64::<LittleEndian>(bf.patch_unknown)?;
    }
    out.extend_from_slice(b"PROP");
    out.write_u32::<LittleEndian>(bf.version)?;
    if bf.version >= 2 {
        out.write_u32::<LittleEndian>(bf.linked_files.len() as u32)?;
        for lf in &bf.linked_files {
            out.write_u16::<LittleEndian>(lf.len() as u16)?;
            out.extend_from_slice(lf);
        }
    }
    out.write_u32::<LittleEndian>(bf.entries.len() as u32)?;
    for e in &bf.entries {
        out.write_u32::<LittleEndian>(e.type_hash)?;
    }
    for e in &bf.entries {
        let mut body: u32 = 4 + 2;
        for (_, fv) in &e.fields {
            body += 4 + 1 + value_size(fv)? as u32;
        }
        out.write_u32::<LittleEndian>(body)?;
        out.write_u32::<LittleEndian>(e.key_hash)?;
        out.write_u16::<LittleEndian>(e.fields.len() as u16)?;
        for (fname, fv) in &e.fields {
            out.write_u32::<LittleEndian>(*fname)?;
            out.write_u8(fv.ty().encode())?;
            write_value(&mut out, fv)?;
        }
    }
    Ok(out)
}

/// Verify parse → serialize is byte-identical for the given BIN. Returns Err on mismatch.
#[allow(dead_code)]
pub fn validate_roundtrip(data: &[u8]) -> Result<()> {
    let bf = parse_bin(data)?;
    let out = serialize_bin(&bf)?;
    if out.len() != data.len() {
        bail!(
            "BIN roundtrip length mismatch: {} vs {}",
            out.len(),
            data.len()
        );
    }
    for (i, (a, b)) in out.iter().zip(data.iter()).enumerate() {
        if a != b {
            bail!("BIN roundtrip diff at byte {}: orig=0x{:02x} new=0x{:02x}", i, b, a);
        }
    }
    Ok(())
}

/// Find first entry of the given type hash, or None.
#[allow(dead_code)]
pub fn find_entry(bf: &BinFile, type_hash: u32) -> Option<&BinEntry> {
    bf.entries.iter().find(|e| e.type_hash == type_hash)
}

/// Find a field within a POINTER/EMBEDDED-style fields list (or any (u32, BinValue) list).
#[allow(dead_code)]
pub fn find_field<'a>(
    fields: &'a [(u32, BinValue)],
    field_name: u32,
) -> Option<&'a BinValue> {
    fields.iter().find_map(|(fn_, fv)| if *fn_ == field_name { Some(fv) } else { None })
}

// ----------------------------- Tests ----------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn build_minimal_bin() -> Vec<u8> {
        // Hand-craft a minimal valid v3 PROP file with one empty entry.
        // PROP magic + version=3 + linked=0 + entries=1 + typeHash + entry body
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"PROP");
        out.write_u32::<LittleEndian>(3).unwrap();
        out.write_u32::<LittleEndian>(0).unwrap(); // 0 linked files
        out.write_u32::<LittleEndian>(1).unwrap(); // 1 entry
        out.write_u32::<LittleEndian>(0xDEADBEEF).unwrap(); // type hash
        // entry body: size + key + fieldCount + fields
        // body content: u32 key, u16 fieldCount (= 0) = 6 bytes
        out.write_u32::<LittleEndian>(4 + 2).unwrap();
        out.write_u32::<LittleEndian>(0xCAFEBABE).unwrap();
        out.write_u16::<LittleEndian>(0).unwrap();
        out
    }

    #[test]
    fn parse_minimal() {
        let data = build_minimal_bin();
        let bf = parse_bin(&data).expect("parse");
        assert_eq!(bf.version, 3);
        assert_eq!(bf.entries.len(), 1);
        assert_eq!(bf.entries[0].type_hash, 0xDEADBEEF);
        assert_eq!(bf.entries[0].key_hash, 0xCAFEBABE);
        assert!(bf.entries[0].fields.is_empty());
    }

    #[test]
    fn roundtrip_minimal() {
        let data = build_minimal_bin();
        validate_roundtrip(&data).expect("roundtrip");
    }

    #[test]
    fn type_encoding_roundtrip() {
        for raw in 0u8..=26u8 {
            let ty = BinType::from_raw(raw).unwrap();
            let encoded = ty.encode();
            let decoded = BinType::decode(encoded).unwrap();
            assert_eq!(decoded as u8, raw, "encode/decode mismatch for type {}", raw);
        }
    }

    #[test]
    fn prim_sizes_match_ts() {
        // Mirror the PRIM_SIZE table from binParser.ts. Non-prim types return None.
        let cases: &[(BinType, Option<usize>)] = &[
            (BinType::None, Some(0)),
            (BinType::Bool, Some(1)),
            (BinType::SInt8, Some(1)),
            (BinType::UInt8, Some(1)),
            (BinType::SInt16, Some(2)),
            (BinType::UInt16, Some(2)),
            (BinType::SInt32, Some(4)),
            (BinType::UInt32, Some(4)),
            (BinType::SInt64, Some(8)),
            (BinType::UInt64, Some(8)),
            (BinType::Float32, Some(4)),
            (BinType::Vec2, Some(8)),
            (BinType::Vec3, Some(12)),
            (BinType::Vec4, Some(16)),
            (BinType::Mtx44, Some(64)),
            (BinType::Rgba, Some(4)),
            (BinType::Hash, Some(4)),
            (BinType::WadEntryLink, Some(8)),
            (BinType::Link, Some(4)),
            (BinType::Flag, Some(1)),
            // Non-prim
            (BinType::String, None),
            (BinType::Container, None),
            (BinType::Struct, None),
            (BinType::Pointer, None),
            (BinType::Embedded, None),
            (BinType::Option, None),
            (BinType::Map, None),
        ];
        for &(ty, expected) in cases {
            assert_eq!(ty.prim_size(), expected, "{:?}", ty);
        }
    }

    /// Round-trip every .bin file in a directory tree. Validates the parser
    /// against real game data. Set BIN_TEST_DIR env var to a directory
    /// containing .bin files and run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn roundtrip_all_bins_in_dir() {
        let dir = std::env::var("BIN_TEST_DIR")
            .expect("set BIN_TEST_DIR env var to a directory with .bin files");

        fn walk(p: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            if p.is_file() {
                if p.extension().and_then(|s| s.to_str()) == Some("bin") {
                    out.push(p.to_path_buf());
                }
                return;
            }
            for entry in std::fs::read_dir(p).unwrap().flatten() {
                walk(&entry.path(), out);
            }
        }

        let mut files = Vec::new();
        walk(std::path::Path::new(&dir), &mut files);
        files.sort();
        assert!(!files.is_empty(), "no .bin files found under {}", dir);

        let mut ok = 0;
        let mut fail = 0;
        for f in &files {
            let data = std::fs::read(f).unwrap();
            match parse_bin(&data).and_then(|bf| serialize_bin(&bf)) {
                Ok(out) => {
                    if out == data {
                        ok += 1;
                    } else {
                        fail += 1;
                        let diff_at = out
                            .iter()
                            .zip(data.iter())
                            .position(|(a, b)| a != b);
                        eprintln!(
                            "DIFF {}: orig={} new={} first_diff_at={:?}",
                            f.display(),
                            data.len(),
                            out.len(),
                            diff_at
                        );
                    }
                }
                Err(e) => {
                    fail += 1;
                    eprintln!("ERR  {}: {}", f.display(), e);
                }
            }
        }
        println!("  Round-trip: {} ok, {} fail", ok, fail);
        assert_eq!(fail, 0, "some round-trips failed");
    }

    #[test]
    fn ptch_magic_parses() {
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"PTCH");
        out.write_u64::<LittleEndian>(0x1234_5678_9ABC_DEF0).unwrap();
        out.extend_from_slice(b"PROP");
        out.write_u32::<LittleEndian>(3).unwrap();
        out.write_u32::<LittleEndian>(0).unwrap(); // 0 linked
        out.write_u32::<LittleEndian>(0).unwrap(); // 0 entries
        let bf = parse_bin(&out).expect("parse PTCH");
        assert!(bf.is_patch);
        assert_eq!(bf.patch_unknown, 0x1234_5678_9ABC_DEF0);
        let out2 = serialize_bin(&bf).unwrap();
        assert_eq!(out, out2);
    }
}
