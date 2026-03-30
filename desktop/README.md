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

`target/release/bundle/`

## Desktop Auto Update

- Updater endpoint is pinned to:
  `https://github.com/zeroclaw-labs/zeroclaw/releases/download/desktop-latest/latest.json`
- The desktop app checks updates at startup.
- When a newer version is found, users get a confirmation dialog before download/install/restart.

## Release (No GitHub Actions Required)

Use the local release scripts in `scripts/release`.

Release guardrails:

- Create new tag only from `main`, and local `HEAD` must match `origin/main`
- If tag already exists, checkout that tag commit before publishing another platform

Single entry command:

```bash
bash scripts/release/cut_release_tag.sh vX.Y.Z --push --publish-desktop
```

This command will:

- Create/push tag if the tag does not exist yet
- If tag already exists, skip tag creation and only publish desktop assets
- Publish updater assets for the current machine platform

Optional flags:

- `--target <triple>`
- `--platform-key <key>`
- `--repo <owner/repo>`
- `--skip-build`

Multi-platform release with the same command (recommended: build on each native OS):

1. On macOS:

```bash
bash scripts/release/cut_release_tag.sh vX.Y.Z --push --publish-desktop
```

2. On Windows machine (checkout the same tag commit):

```bash
bash scripts/release/cut_release_tag.sh vX.Y.Z --publish-desktop --target x86_64-pc-windows-msvc --platform-key windows-x86_64
```

`latest.json` is merged by platform key, so running publish on another machine appends/replaces only that platform entry instead of overwriting all platforms.

The publish script will:

- Validate desktop/root version consistency
- Build web + desktop artifacts (unless `--skip-build`)
- Generate updater `latest.json`
- Upload bundle, signature and `latest.json` to GitHub release tag `desktop-latest`

## Architecture

- **Backend**: Uses `zeroclaw` as a library and starts daemon in-process.
- **Frontend**: Loads local web app served from `http://localhost:42617`.
- **Configuration**: Reuses standard ZeroClaw config location.
