use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use zip::ZipArchive;

mod bin_parser;
mod overlay;
mod patcher;
mod skin0_swap;

#[derive(Parser)]
#[command(
    name = "bocchi-overlay",
    version,
    about = "Bocchi sidecar for League mod archives (.fantome / .modpkg) and patcher"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print parsed META/info.json from a .fantome archive as JSON.
    Info {
        /// Path to the .fantome file
        path: PathBuf,
    },
    /// Build a League mod overlay from one or more .fantome archives.
    Mkoverlay {
        /// League game directory (.../League of Legends/Game).
        #[arg(long)]
        game: PathBuf,
        /// Output overlay directory (will be created).
        #[arg(long)]
        overlay: PathBuf,
        /// State directory for persistent indices (must be writable).
        #[arg(long)]
        state: PathBuf,
        /// One or more .fantome archive paths (pass `--mod` multiple times).
        #[arg(long = "mod", value_name = "FANTOME", required = true)]
        mods: Vec<String>,
    },
    /// Generate one or more skin0-swap .fantome archives from a champion WAD.
    ///
    /// Reads a JSON request from --request-json (or stdin if "-"). The request
    /// matches the `GenerationRequest` struct (wadPath, champion, items[],
    /// outputDir, author, hashtablePath). Outputs a JSON array of results on
    /// stdout: each result has {success, skinNumber, outputPath?, sizeBytes?, error?}.
    Fantonize {
        /// Path to a JSON file with the request, or "-" to read from stdin.
        #[arg(long)]
        request_json: String,
    },
    /// Load cslol-dll.dll and run the patcher loop until stdin closes.
    ///
    /// Stdout streams `[DLL] ...` log lines for the parent process;
    /// stderr carries our own diagnostics. Writing any line to stdin
    /// (or closing it) signals graceful shutdown.
    Patcher {
        /// Path to cslol-dll.dll.
        #[arg(long)]
        dll: PathBuf,
        /// Overlay root (the directory produced by the mkoverlay subcommand).
        #[arg(long)]
        overlay_root: String,
        /// Optional log file the DLL will write to.
        #[arg(long)]
        log_file: Option<String>,
        /// Hook initialization timeout in ms.
        #[arg(long, default_value_t = patcher::DEFAULT_HOOK_TIMEOUT_MS)]
        timeout_ms: u32,
        /// Patcher flags (forwarded to cslol_set_flags). 0 == --opts:none.
        #[arg(long, default_value_t = 0)]
        flags: u64,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Info { path } => cmd_info(&path),
        Command::Mkoverlay {
            game,
            overlay,
            state,
            mods,
        } => overlay::build_overlay(&game, &overlay, &state, &mods),
        Command::Fantonize { request_json } => cmd_fantonize(&request_json),
        Command::Patcher {
            dll,
            overlay_root,
            log_file,
            timeout_ms,
            flags,
        } => cmd_patcher(
            &dll,
            &overlay_root,
            log_file.as_deref(),
            timeout_ms,
            flags,
        ),
    }
}

fn cmd_fantonize(request_arg: &str) -> Result<()> {
    let json_text = if request_arg == "-" {
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .context("reading request JSON from stdin")?;
        buf
    } else {
        std::fs::read_to_string(request_arg)
            .with_context(|| format!("reading request JSON from {}", request_arg))?
    };
    let request: skin0_swap::GenerationRequest =
        serde_json::from_str(&json_text).context("parsing GenerationRequest JSON")?;
    let results = skin0_swap::generate_fantomes(&request)?;
    let out = serde_json::to_string(&results)?;
    println!("{}", out);
    Ok(())
}

fn cmd_info(path: &PathBuf) -> Result<()> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut archive = ZipArchive::new(file).context("reading zip archive")?;

    let mut info_index = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        if entry.name().eq_ignore_ascii_case("META/info.json") {
            info_index = Some(i);
            break;
        }
    }
    let idx = info_index.context("META/info.json not found in archive")?;

    let mut info_file = archive.by_index(idx)?;
    let mut raw = String::new();
    info_file.read_to_string(&mut raw)?;
    let raw = raw.trim_start_matches('\u{feff}').trim();

    let info: ltk_fantome::FantomeInfo =
        serde_json::from_str(raw).context("parsing META/info.json")?;

    println!("{}", serde_json::to_string_pretty(&info)?);
    Ok(())
}

fn cmd_patcher(
    dll: &PathBuf,
    overlay_root: &str,
    log_file: Option<&str>,
    timeout_ms: u32,
    flags: u64,
) -> Result<()> {
    if !dll.exists() {
        anyhow::bail!("DLL not found at {}", dll.display());
    }

    // Any byte on stdin (or EOF) requests a graceful shutdown.
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let stop_flag = stop_flag.clone();
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut reader = BufReader::new(stdin.lock());
            let mut line = String::new();
            // Either a newline arrives or stdin closes — either is the stop signal.
            let _ = reader.read_line(&mut line);
            stop_flag.store(true, Ordering::SeqCst);
            eprintln!("[PATCHER] Stop requested");
        });
    }

    let mut overlay_root = overlay_root.to_string();
    if !overlay_root.ends_with(std::path::MAIN_SEPARATOR) {
        overlay_root.push(std::path::MAIN_SEPARATOR);
    }

    match patcher::run_patcher_loop(
        dll,
        &overlay_root,
        log_file,
        timeout_ms,
        flags,
        &stop_flag,
    ) {
        Ok(()) => Ok(()),
        Err(patcher::PatcherLoopError::Stopped) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("{}", e)),
    }
}
