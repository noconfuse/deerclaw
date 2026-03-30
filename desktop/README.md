# ZeroClaw Desktop

ZeroClaw Desktop is a Tauri app that embeds the `zeroclaw` daemon in-process and loads the web UI in a native window.

## Prerequisites

- Node.js 20+
- Rust toolchain
- System dependencies required by Tauri for your OS
- Same base dependencies as the root project

For release publishing without GitHub Actions:

- GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
- `TAURI_PRIVATE_KEY` exported in your shell
- `TAURI_KEY_PASSWORD` exported if your private key is password-protected

## Development

1. Install frontend dependencies:

   ```bash
   cd web
   npm ci
   cd ../desktop
   npm ci
   ```

2. Build web assets:

   ```bash
   cd ../web
   npm run build
   ```

3. Run desktop app:

   ```bash
   cd ../desktop
   npm run tauri dev
   ```

## Production Build

Build locally:

```bash
cd web
npm ci
npm run build
cd ../desktop
npm ci
npm run tauri build
```

Build artifacts are generated in:

`desktop/src-tauri/target/release/bundle/`

## Desktop Auto Update

- Updater endpoint is pinned to:
  `https://github.com/zeroclaw-labs/zeroclaw/releases/download/desktop-latest/latest.json`
- The desktop app checks updates at startup.
- When a newer version is found, users get a confirmation dialog before download/install/restart.

## Release (No GitHub Actions Required)

Use the local release scripts in `scripts/release`.

Release guardrails:

- Run release from `main` branch only
- Local `HEAD` must match `origin/main`

One-command flow (tag + push + desktop update publish):

```bash
bash scripts/release/cut_release_tag.sh vX.Y.Z --push --publish-desktop
```

Desktop publish only:

```bash
bash scripts/release/publish_desktop_local.sh
```

Optional flags:

- `--target <triple>`
- `--platform-key <key>`
- `--repo <owner/repo>`
- `--skip-build`

The publish script will:

- Validate desktop/root version consistency
- Build web + desktop artifacts (unless `--skip-build`)
- Generate updater `latest.json`
- Upload bundle, signature and `latest.json` to GitHub release tag `desktop-latest`

## Architecture

- **Backend**: Uses `zeroclaw` as a library and starts daemon in-process.
- **Frontend**: Loads local web app served from `http://localhost:42617`.
- **Configuration**: Reuses standard ZeroClaw config location.
