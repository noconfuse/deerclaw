#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/release/publish_desktop_local.sh [--target <triple>] [--platform-key <key>] [--repo <owner/repo>] [--skip-build]

Publish desktop updater assets to GitHub Release tag desktop-latest without GitHub Actions.

Options:
  --target <triple>        Rust target triple (e.g. aarch64-apple-darwin)
  --platform-key <key>     Updater platform key (e.g. darwin-aarch64)
  --repo <owner/repo>      GitHub repository slug
  --skip-build             Skip build and only upload artifacts from target bundle dir
USAGE
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TARGET=""
PLATFORM_KEY=""
REPO_SLUG=""
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --platform-key)
      PLATFORM_KEY="${2:-}"
      shift 2
      ;;
    --repo)
      REPO_SLUG="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

for cmd in git gh python3 npm cargo; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: missing required command: $cmd" >&2
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if [[ -z "${TAURI_PRIVATE_KEY:-}" ]]; then
  echo "error: TAURI_PRIVATE_KEY is required for signed updater bundles" >&2
  exit 1
fi

VERSION="$(python3 - <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(".")
checks = []
cargo_desktop = (root / "desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
m = re.search(r'^version = "([^"]+)"', cargo_desktop, flags=re.M)
checks.append(("desktop/src-tauri/Cargo.toml", m.group(1) if m else None))
tauri_conf = json.loads((root / "desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
checks.append(("desktop/src-tauri/tauri.conf.json", tauri_conf["package"]["version"]))
desktop_pkg = json.loads((root / "desktop/package.json").read_text(encoding="utf-8"))
checks.append(("desktop/package.json", desktop_pkg["version"]))
root_cargo = (root / "Cargo.toml").read_text(encoding="utf-8")
m_root = re.search(r'^version = "([^"]+)"', root_cargo, flags=re.M)
checks.append(("Cargo.toml", m_root.group(1) if m_root else None))
versions = {v for _, v in checks}
if len(versions) != 1:
    for p, v in checks:
        print(f"error: {p} version={v}", file=sys.stderr)
    sys.exit(1)
print(next(iter(versions)))
PY
)"

if [[ -z "$REPO_SLUG" ]]; then
  REMOTE_URL="$(git remote get-url origin)"
  if [[ "$REMOTE_URL" =~ ^git@github.com:([^/]+/[^/]+)(\.git)?$ ]]; then
    REPO_SLUG="${BASH_REMATCH[1]}"
  elif [[ "$REMOTE_URL" =~ ^https://github.com/([^/]+/[^/]+)(\.git)?$ ]]; then
    REPO_SLUG="${BASH_REMATCH[1]}"
  else
    echo "error: cannot infer repo slug from origin url: $REMOTE_URL" >&2
    echo "hint: pass --repo owner/repo" >&2
    exit 1
  fi
  REPO_SLUG="${REPO_SLUG%.git}"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  (
    cd web
    npm ci
    npm run build
  )

  (
    cd desktop
    npm ci
    if [[ -n "$TARGET" ]]; then
      npm run tauri build -- --target "$TARGET"
    else
      npm run tauri build
    fi
  )
fi

if [[ -n "$TARGET" ]]; then
  BUNDLE_DIR="desktop/src-tauri/target/${TARGET}/release/bundle"
else
  BUNDLE_DIR="desktop/src-tauri/target/release/bundle"
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "error: bundle directory not found: $BUNDLE_DIR" >&2
  exit 1
fi

ARTIFACT_PATH=""
for pattern in "*.app.tar.gz" "*.AppImage.tar.gz" "*.nsis.zip" "*.msi.zip"; do
  candidate="$(find "$BUNDLE_DIR" -type f -name "$pattern" | head -1 || true)"
  if [[ -n "$candidate" ]]; then
    ARTIFACT_PATH="$candidate"
    break
  fi
done

if [[ -z "$ARTIFACT_PATH" ]]; then
  echo "error: updater archive not found in $BUNDLE_DIR" >&2
  exit 1
fi

SIG_PATH="${ARTIFACT_PATH}.sig"
if [[ ! -f "$SIG_PATH" ]]; then
  echo "error: signature file not found: $SIG_PATH" >&2
  exit 1
fi

if [[ -z "$PLATFORM_KEY" ]]; then
  detect_target="$TARGET"
  if [[ -z "$detect_target" ]]; then
    sys="$(uname -s)"
    arch="$(uname -m)"
    case "$sys:$arch" in
      Darwin:arm64|Darwin:aarch64) detect_target="aarch64-apple-darwin" ;;
      Darwin:x86_64) detect_target="x86_64-apple-darwin" ;;
      Linux:x86_64) detect_target="x86_64-unknown-linux-gnu" ;;
      Linux:aarch64|Linux:arm64) detect_target="aarch64-unknown-linux-gnu" ;;
      *) detect_target="" ;;
    esac
  fi

  case "$detect_target" in
    aarch64-apple-darwin) PLATFORM_KEY="darwin-aarch64" ;;
    x86_64-apple-darwin) PLATFORM_KEY="darwin-x86_64" ;;
    x86_64-unknown-linux-gnu) PLATFORM_KEY="linux-x86_64" ;;
    aarch64-unknown-linux-gnu) PLATFORM_KEY="linux-aarch64" ;;
    x86_64-pc-windows-msvc) PLATFORM_KEY="windows-x86_64" ;;
    aarch64-pc-windows-msvc) PLATFORM_KEY="windows-aarch64" ;;
    *)
      echo "error: cannot infer updater platform key. Pass --platform-key" >&2
      exit 1
      ;;
  esac
fi

ASSET_NAME="$(basename "$ARTIFACT_PATH")"
SIG_NAME="$(basename "$SIG_PATH")"
ASSET_URL="https://github.com/${REPO_SLUG}/releases/download/desktop-latest/${ASSET_NAME}"
SIGNATURE="$(tr -d '\r\n' < "$SIG_PATH")"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
LATEST_JSON_PATH="${TMP_DIR}/latest.json"

python3 - <<PY
import datetime
import json

payload = {
    "version": "v${VERSION}",
    "notes": "Desktop release v${VERSION}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "platforms": {
        "${PLATFORM_KEY}": {
            "signature": "${SIGNATURE}",
            "url": "${ASSET_URL}",
        }
    },
}
with open("${LATEST_JSON_PATH}", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

if gh release view desktop-latest --repo "$REPO_SLUG" >/dev/null 2>&1; then
  gh release edit desktop-latest \
    --repo "$REPO_SLUG" \
    --title "Desktop Update Channel" \
    --notes "Automated desktop update channel release (current app version: ${VERSION})"
else
  gh release create desktop-latest \
    --repo "$REPO_SLUG" \
    --title "Desktop Update Channel" \
    --notes "Automated desktop update channel release (current app version: ${VERSION})"
fi

gh release upload desktop-latest \
  --repo "$REPO_SLUG" \
  "$ARTIFACT_PATH" \
  "$SIG_PATH" \
  "$LATEST_JSON_PATH" \
  --clobber

echo "Published desktop updater assets to https://github.com/${REPO_SLUG}/releases/tag/desktop-latest"
echo "Updater endpoint: https://github.com/${REPO_SLUG}/releases/download/desktop-latest/latest.json"
