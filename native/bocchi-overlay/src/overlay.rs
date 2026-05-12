//! Build a League mod overlay from a list of .fantome archives.

use anyhow::{Context, Result};
use camino::Utf8PathBuf;
use ltk_overlay::{EnabledMod, FantomeContent, OverlayBuilder};
use std::fs::File;
use std::path::Path;

/// Build the overlay from a list of .fantome archive paths.
///
/// `state_dir` holds persistent caches (indices, per-mod WAD reports).
/// It MUST be writable. We use `<overlay>/.state`.
pub fn build_overlay(
    game_dir: &Path,
    overlay_root: &Path,
    state_dir: &Path,
    fantome_paths: &[String],
) -> Result<()> {
    eprintln!("[OVERLAY] game:    {}", game_dir.display());
    eprintln!("[OVERLAY] root:    {}", overlay_root.display());
    eprintln!("[OVERLAY] state:   {}", state_dir.display());
    eprintln!("[OVERLAY] mods:    {}", fantome_paths.len());

    std::fs::create_dir_all(overlay_root)
        .with_context(|| format!("creating overlay dir {}", overlay_root.display()))?;
    std::fs::create_dir_all(state_dir)
        .with_context(|| format!("creating state dir {}", state_dir.display()))?;

    let utf8_game = Utf8PathBuf::from_path_buf(game_dir.to_path_buf())
        .map_err(|p| anyhow::anyhow!("non-UTF8 game path: {}", p.display()))?;
    let utf8_overlay = Utf8PathBuf::from_path_buf(overlay_root.to_path_buf())
        .map_err(|p| anyhow::anyhow!("non-UTF8 overlay path: {}", p.display()))?;
    let utf8_state = Utf8PathBuf::from_path_buf(state_dir.to_path_buf())
        .map_err(|p| anyhow::anyhow!("non-UTF8 state path: {}", p.display()))?;

    let mut builder = OverlayBuilder::new(utf8_game, utf8_overlay, utf8_state).with_progress(
        |p| {
            let stage = format!("{:?}", p.stage);
            if let Some(file) = &p.current_file {
                eprintln!(
                    "[OVERLAY] {} [{}/{}] {}",
                    stage, p.current, p.total, file
                );
            } else {
                eprintln!("[OVERLAY] {} [{}/{}]", stage, p.current, p.total);
            }
        },
    );

    let mut enabled_mods: Vec<EnabledMod> = Vec::with_capacity(fantome_paths.len());
    for (idx, path_str) in fantome_paths.iter().enumerate() {
        let path = Path::new(path_str);
        if !path.exists() {
            eprintln!("[OVERLAY] WARN: skipping missing fantome: {}", path.display());
            continue;
        }
        let utf8_path = Utf8PathBuf::from_path_buf(path.to_path_buf())
            .map_err(|p| anyhow::anyhow!("non-UTF8 mod path: {}", p.display()))?;

        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| format!("mod_{}_{}", idx, s))
            .unwrap_or_else(|| format!("mod_{}", idx));

        let file = File::open(path)
            .with_context(|| format!("opening fantome {}", path.display()))?;
        let content = FantomeContent::new(file)
            .with_context(|| format!("reading fantome archive {}", path.display()))?
            .with_archive_path(utf8_path);

        eprintln!("[OVERLAY] mod {}: {}", id, path.display());
        enabled_mods.push(EnabledMod {
            id,
            content: Box::new(content),
            enabled_layers: None,
        });
    }

    if enabled_mods.is_empty() {
        anyhow::bail!("no usable .fantome inputs");
    }

    builder.set_enabled_mods(enabled_mods);
    builder
        .build()
        .map_err(|e| anyhow::anyhow!("overlay build failed: {}", e))?;

    eprintln!("[OVERLAY] done");
    Ok(())
}
