# bocchi-overlay

Sidecar binary used by Bocchi to read League of Legends mod archives
(`.fantome`, `.modpkg`) and build mod overlays for the patcher.

This crate is licensed `MIT OR Apache-2.0` and depends only on the upstream
`ltk_*` crates published by the LeagueToolkit organization, which carry the
same dual license. It does **not** redistribute `cslol-dll.dll`.

## Build

```bash
cd native/bocchi-overlay
cargo build --release
```

Output: `target/release/bocchi-overlay` (or `bocchi-overlay.exe` on Windows).

## Commands

### `info <path>`

Parse a `.fantome` archive's `META/info.json` and print it as pretty JSON.

```bash
bocchi-overlay info path/to/skin.fantome
```

More commands (`build`, `verify`) will be added as the integration progresses.
