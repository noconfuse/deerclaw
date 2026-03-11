# ZeroClaw Desktop

This is a Tauri-based desktop wrapper for ZeroClaw. It embeds the `zeroclaw` daemon and serves the web interface in a native window.

## Prerequisites

- Node.js (for Tauri CLI)
- Rust (for Tauri backend)
- ZeroClaw dependencies (same as root project)

## Setup

1. Install dependencies:
   ```bash
   cd desktop
   npm install
   ```

2. Build the web frontend:
   ```bash
   cd ../web
   npm install
   npm run build
   ```

3. Run in development mode:
   ```bash
   cd ../desktop
   npm run tauri dev
   ```

4. Build for production:
   ```bash
   npm run tauri build
   ```
   The output will be in `desktop/src-tauri/target/release/bundle/`.

## Architecture

- **Backend**: Uses `zeroclaw` as a library to run the daemon in-process.
- **Frontend**: Serves the `web/dist` files via `http://localhost:42617` (or whatever port is configured).
- **Configuration**: Uses the standard ZeroClaw configuration file location.

## Note on Icons

The `icons/` directory contains placeholder files. For a proper release, replace them with valid icon files:
- `icon.png`: 512x512
- `icon.icns`: macOS icon bundle
- `icon.ico`: Windows icon
