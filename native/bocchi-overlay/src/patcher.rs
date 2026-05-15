//! In-process patcher DLL loader and run-loop.
//!
//! Loads `cslol-dll.dll` into this process and drives its hook lifecycle.
//! Logs from the DLL and our own diagnostics are streamed to stdout
//! line by line, prefixed with `[DLL]` / `[PATCHER]`. The host process
//! consumes these through the stdin pipe; writing any line (or closing
//! stdin) signals graceful shutdown.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use libloading::Library;

/// Default timeout for hook initialization (5 minutes in ms).
pub const DEFAULT_HOOK_TIMEOUT_MS: u32 = 300_000;
/// Step interval for the hook loop (ms).
pub const HOOK_STEP_MS: u32 = 100;

#[repr(u64)]
#[allow(dead_code)]
#[derive(Copy, Clone, Debug)]
pub enum CSLogLevel {
    Error = 0x0,
    Warn = 0x8,
    Info = 0x10,
    Debug = 0x20,
    Trace = 0x1000,
}

#[derive(thiserror::Error, Debug)]
pub enum PatcherError {
    #[error("Failed to load patcher DLL: {0}")]
    LoadFailed(#[from] libloading::Error),
    #[error("Patcher DLL is missing required export '{symbol}': {source}")]
    MissingSymbol {
        symbol: &'static str,
        #[source]
        source: libloading::Error,
    },
    #[error("Failed to initialize cslol: {0}")]
    InitFailed(String),
    #[error("Failed to set patcher config: {0}")]
    SetConfigFailed(String),
    #[error("Failed to set patcher flags: {0}")]
    SetFlagsFailed(String),
    #[error("Failed to set patcher log level: {0}")]
    SetLogLevelFailed(String),
    #[error("Failed to set patcher log file: {0}")]
    SetLogFileFailed(String),
    #[error("Failed to hook: {0}")]
    HookFailed(String),
}

/// Read a null-terminated UTF-8 byte string returned by the DLL into a Rust
/// String. Returns None if the pointer is null (the DLL's success signal).
unsafe fn cstr_to_str(ptr: *const u8) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    Some(String::from_utf8_lossy(slice).into_owned())
}

/// Encode a Rust string as a null-terminated UTF-16LE buffer for Win32 APIs.
fn str_to_cstr_utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub struct PatcherApi {
    /// Keeps the DLL loaded for as long as the API instance lives.
    #[allow(dead_code)]
    library: Library,
    cslol_init: unsafe extern "C" fn() -> *const u8,
    cslol_set_config: unsafe extern "C" fn(*const u16) -> *const u8,
    cslol_set_flags: unsafe extern "C" fn(u64) -> *const u8,
    cslol_set_log_level: unsafe extern "C" fn(CSLogLevel) -> *const u8,
    cslol_set_log_file: Option<unsafe extern "C" fn(*const u16) -> *const u8>,
    cslol_find: unsafe extern "C" fn() -> u32,
    cslol_sleep: Option<unsafe extern "C" fn(u32)>,
    cslol_hook: unsafe extern "C" fn(u32, u32, u32) -> *const u8,
    cslol_log_pull: Option<unsafe extern "C" fn() -> *const u8>,
}

impl PatcherApi {
    pub fn load(dll_path: &Path) -> Result<Self, PatcherError> {
        let lib = unsafe { Library::new(dll_path)? };

        macro_rules! get_symbol {
            ($lib:expr, $name:literal) => {
                *$lib.get($name).map_err(|e| PatcherError::MissingSymbol {
                    symbol: std::str::from_utf8($name).unwrap_or("<invalid>"),
                    source: e,
                })?
            };
        }

        unsafe {
            let cslol_set_log_file = lib
                .get::<unsafe extern "C" fn(*const u16) -> *const u8>(b"cslol_set_log_file")
                .ok()
                .map(|s| *s);
            let cslol_log_pull = lib
                .get::<unsafe extern "C" fn() -> *const u8>(b"cslol_log_pull")
                .ok()
                .map(|s| *s);
            let cslol_sleep = lib
                .get::<unsafe extern "C" fn(u32)>(b"cslol_sleep")
                .ok()
                .map(|s| *s);

            Ok(Self {
                cslol_init: get_symbol!(lib, b"cslol_init"),
                cslol_set_config: get_symbol!(lib, b"cslol_set_config"),
                cslol_set_flags: get_symbol!(lib, b"cslol_set_flags"),
                cslol_set_log_level: get_symbol!(lib, b"cslol_set_log_level"),
                cslol_set_log_file,
                cslol_find: get_symbol!(lib, b"cslol_find"),
                cslol_sleep,
                cslol_hook: get_symbol!(lib, b"cslol_hook"),
                cslol_log_pull,
                library: lib,
            })
        }
    }

    pub fn init(&self) -> Result<(), PatcherError> {
        unsafe {
            match cstr_to_str((self.cslol_init)()) {
                Some(err) => Err(PatcherError::InitFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn set_config(&self, prefix: &str) -> Result<(), PatcherError> {
        unsafe {
            match cstr_to_str((self.cslol_set_config)(str_to_cstr_utf16(prefix).as_ptr())) {
                Some(err) => Err(PatcherError::SetConfigFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn set_flags(&self, flags: u64) -> Result<(), PatcherError> {
        unsafe {
            match cstr_to_str((self.cslol_set_flags)(flags)) {
                Some(err) => Err(PatcherError::SetFlagsFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn set_log_level(&self, log_level: CSLogLevel) -> Result<(), PatcherError> {
        unsafe {
            match cstr_to_str((self.cslol_set_log_level)(log_level)) {
                Some(err) => Err(PatcherError::SetLogLevelFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn set_log_file(&self, log_path: &str) -> Result<(), PatcherError> {
        let Some(set_log_file) = self.cslol_set_log_file else {
            return Ok(());
        };
        unsafe {
            match cstr_to_str(set_log_file(str_to_cstr_utf16(log_path).as_ptr())) {
                Some(err) => Err(PatcherError::SetLogFileFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn find(&self) -> Option<NonZeroU32> {
        unsafe { NonZeroU32::new((self.cslol_find)()) }
    }

    pub fn sleep(&self, ms: u32) {
        if let Some(sleep) = self.cslol_sleep {
            unsafe { sleep(ms) }
        } else {
            std::thread::sleep(Duration::from_millis(ms as u64));
        }
    }

    pub fn hook(&self, tid: u32, timeout_ms: u32, step_ms: u32) -> Result<(), PatcherError> {
        unsafe {
            match cstr_to_str((self.cslol_hook)(tid, timeout_ms, step_ms)) {
                Some(err) => Err(PatcherError::HookFailed(err)),
                None => Ok(()),
            }
        }
    }

    pub fn log_pull(&self) -> Option<String> {
        let pull = self.cslol_log_pull?;
        unsafe { cstr_to_str(pull()) }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum PatcherLoopError {
    #[error(transparent)]
    Patcher(#[from] PatcherError),
    #[error("Patcher stopped by request")]
    Stopped,
}

/// Run the patcher loop.
///
/// Continuously waits for a League instance to appear, hooks it, drains DLL
/// logs while the game runs, then loops back to wait for another launch
/// (until `stop_flag` is set).
pub fn run_patcher_loop(
    dll_path: &Path,
    overlay_root: &str,
    log_file: Option<&str>,
    timeout_ms: u32,
    flags: u64,
    stop_flag: &AtomicBool,
) -> Result<(), PatcherLoopError> {
    eprintln!("[PATCHER] Loading DLL: {}", dll_path.display());
    let api = PatcherApi::load(dll_path)?;

    eprintln!("[PATCHER] set_flags({})", flags);
    api.set_flags(flags)?;

    eprintln!("[PATCHER] init()");
    api.init()?;

    eprintln!("[PATCHER] set_config('{}')", overlay_root);
    api.set_config(overlay_root)?;

    api.set_log_level(CSLogLevel::Info)?;

    if let Some(log_path) = log_file {
        eprintln!("[PATCHER] set_log_file('{}')", log_path);
        api.set_log_file(log_path)?;
    }

    eprintln!("[PATCHER] Initialized. Waiting for game...");

    loop {
        if stop_flag.load(Ordering::SeqCst) {
            return Err(PatcherLoopError::Stopped);
        }

        let mut last_wait_log = Instant::now();
        let tid = loop {
            if stop_flag.load(Ordering::SeqCst) {
                return Err(PatcherLoopError::Stopped);
            }
            match api.find() {
                Some(tid) => break tid.get(),
                None => {
                    if last_wait_log.elapsed() >= Duration::from_secs(5) {
                        eprintln!("[PATCHER] Still waiting for game process...");
                        last_wait_log = Instant::now();
                    }
                    api.sleep(100);
                }
            }
        };

        eprintln!("[PATCHER] Game found (thread id: {})", tid);

        eprintln!(
            "[PATCHER] Applying hook (timeout={}ms, step={}ms)...",
            timeout_ms, HOOK_STEP_MS
        );
        api.hook(tid, timeout_ms, HOOK_STEP_MS)?;
        eprintln!("[PATCHER] Hook applied. Waiting for game to exit...");

        while !stop_flag.load(Ordering::SeqCst) {
            match api.find() {
                Some(current) if current.get() == tid => {
                    while let Some(msg) = api.log_pull() {
                        println!("[DLL] {}", msg);
                    }
                    api.sleep(1000);
                }
                _ => break,
            }
        }

        eprintln!("[PATCHER] Game exited. Returning to wait loop.");
    }
}
