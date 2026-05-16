#![cfg_attr(not(feature = "private-impl"), allow(dead_code))]

use anyhow::{anyhow, Context, Result};
use ltk_wad::{Wad, WadChunk};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use xxhash_rust::xxh64::xxh64;

#[cfg(feature = "private-impl")]
#[path = "skin0_swap_impl.rs"]
mod private_impl;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationItem {
    pub skin_number: u32,
    pub file_label: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub wad_path: PathBuf,
    pub champion: String,
    pub items: Vec<GenerationItem>,
    pub output_dir: PathBuf,
    pub author: String,
    pub hashtable_path: PathBuf,
    #[serde(default)]
    pub pet_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub success: bool,
    pub skin_number: u32,
    pub output_path: Option<PathBuf>,
    pub size_bytes: Option<u64>,
    pub error: Option<String>,
}

pub(crate) fn xxh64_path(p: &str) -> u64 {
    xxh64(p.to_lowercase().as_bytes(), 0)
}

#[derive(Serialize)]
pub(crate) struct FantomeInfo<'a> {
    #[serde(rename = "Name")]
    pub name: &'a str,
    #[serde(rename = "Author")]
    pub author: &'a str,
    #[serde(rename = "Version")]
    pub version: &'a str,
    #[serde(rename = "Description")]
    pub description: &'a str,
}

fn sanitize_filename(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_ws = false;
    for ch in out.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                collapsed.push(' ');
            }
            prev_ws = true;
        } else {
            collapsed.push(ch);
            prev_ws = false;
        }
    }
    collapsed.trim().to_string()
}

pub(crate) struct PreparedWad {
    pub(crate) wad: Wad<File>,
    pub(crate) chunks_by_hash: HashMap<u64, WadChunk>,
    pub(crate) hash_to_path: HashMap<u64, String>,
}

impl PreparedWad {
    fn open(wad_path: &Path, hashtable_path: &Path) -> Result<Self> {
        let f = File::open(wad_path)
            .with_context(|| format!("opening WAD {}", wad_path.display()))?;
        let wad = Wad::mount(f).map_err(|e| anyhow!("Wad::mount: {}", e))?;

        let mut chunks_by_hash: HashMap<u64, WadChunk> = HashMap::new();
        let mut needed: HashSet<u64> = HashSet::new();
        for chunk in wad.chunks().iter() {
            let h = chunk.path_hash();
            chunks_by_hash.insert(h, *chunk);
            needed.insert(h);
        }

        let hash_to_path = stream_load_hashtable(hashtable_path, &needed)?;

        Ok(Self {
            wad,
            chunks_by_hash,
            hash_to_path,
        })
    }

    pub(crate) fn get_chunk_bytes(&mut self, lc_path: &str) -> Option<Vec<u8>> {
        let h = xxh64_path(lc_path);
        let chunk = self.chunks_by_hash.get(&h).copied()?;
        match self.wad.load_chunk_decompressed(&chunk) {
            Ok(b) => Some(b.to_vec()),
            Err(_) => None,
        }
    }
}

fn stream_load_hashtable(path: &Path, needed: &HashSet<u64>) -> Result<HashMap<u64, String>> {
    let mut out: HashMap<u64, String> = HashMap::new();
    if needed.is_empty() {
        return Ok(out);
    }

    let f = File::open(path)
        .with_context(|| format!("opening hashtable {}", path.display()))?;
    let reader = BufReader::new(f);
    let mut remaining = needed.len();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if remaining == 0 {
            break;
        }
        let sp = match line.find(' ') {
            Some(i) => i,
            None => continue,
        };
        let hex = &line[..sp];
        let h = match u64::from_str_radix(hex, 16) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if needed.contains(&h) && !out.contains_key(&h) {
            out.insert(h, line[sp + 1..].to_string());
            remaining -= 1;
        }
    }
    Ok(out)
}

#[cfg(feature = "private-impl")]
fn build_fantome(
    prep: &mut PreparedWad,
    main_wad_path: &Path,
    hashtable_path: &Path,
    champion: &str,
    src_skin_number: u32,
    info_name: &str,
    info_author: &str,
    pet_names: &[String],
) -> Result<Vec<u8>> {
    private_impl::build_fantome(
        prep,
        main_wad_path,
        hashtable_path,
        champion,
        src_skin_number,
        info_name,
        info_author,
        pet_names,
    )
}

#[cfg(not(feature = "private-impl"))]
fn build_fantome(
    _prep: &mut PreparedWad,
    _main_wad_path: &Path,
    _hashtable_path: &Path,
    _champion: &str,
    _src_skin_number: u32,
    _info_name: &str,
    _info_author: &str,
    _pet_names: &[String],
) -> Result<Vec<u8>> {
    anyhow::bail!(
        "This build does not include the proprietary fantome-generation \
         module. Rebuild with `--features private-impl` and the private \
         source file present, or use an official release binary."
    )
}

pub fn generate_fantomes(request: &GenerationRequest) -> Result<Vec<GenerationResult>> {
    if !request.output_dir.exists() {
        std::fs::create_dir_all(&request.output_dir)
            .with_context(|| format!("creating output dir {}", request.output_dir.display()))?;
    }
    let mut prep = PreparedWad::open(&request.wad_path, &request.hashtable_path)?;

    let mut results: Vec<GenerationResult> = Vec::with_capacity(request.items.len());
    for item in &request.items {
        let r = match build_fantome(
            &mut prep,
            &request.wad_path,
            &request.hashtable_path,
            &request.champion,
            item.skin_number,
            &item.display_name,
            &request.author,
            &request.pet_names,
        ) {
            Ok(bytes) => {
                let name = format!("{}.fantome", sanitize_filename(&item.file_label));
                let out_path = request.output_dir.join(&name);
                match std::fs::write(&out_path, &bytes) {
                    Ok(()) => GenerationResult {
                        success: true,
                        skin_number: item.skin_number,
                        output_path: Some(out_path.clone()),
                        size_bytes: Some(bytes.len() as u64),
                        error: None,
                    },
                    Err(e) => GenerationResult {
                        success: false,
                        skin_number: item.skin_number,
                        output_path: None,
                        size_bytes: None,
                        error: Some(format!("write failed: {}", e)),
                    },
                }
            }
            Err(e) => GenerationResult {
                success: false,
                skin_number: item.skin_number,
                output_path: None,
                size_bytes: None,
                error: Some(e.to_string()),
            },
        };
        results.push(r);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xxh64_known() {
        assert_eq!(xxh64_path("test"), 5754696928334414137_u64);
    }

    #[test]
    fn xxh64_lowercases() {
        assert_eq!(xxh64_path("Data/Characters/Akali"), xxh64_path("data/characters/akali"));
    }

    #[test]
    fn sanitize_filename_basics() {
        assert_eq!(sanitize_filename("Star Guardian Akali"), "Star Guardian Akali");
        assert_eq!(sanitize_filename("Star  Guardian   Akali"), "Star Guardian Akali");
        assert_eq!(sanitize_filename("foo/bar:baz"), "foo_bar_baz");
        assert_eq!(sanitize_filename("  trim me  "), "trim me");
    }
}
