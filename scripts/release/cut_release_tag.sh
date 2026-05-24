#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/release/cut_release_tag.sh <tag> [--push] [--publish-desktop] [--target <triple>] [--platform-key <key>] [--repo <owner/repo>] [--skip-build]

Create/push release tag and publish desktop updater assets with a single script.

Requirements:
- tag must match vX.Y.Z (optional suffix like -rc.1)
- working tree must be clean
- if creating a new tag: current branch must be main and HEAD must match origin/main
- if tag already exists: checkout that tag commit before publishing assets

Options:
  --push                  Push the tag to origin after creating it
  --publish-desktop       Build desktop and upload updater assets
  --target <triple>       Rust target triple (e.g. aarch64-apple-darwin)
  --platform-key <key>    Updater platform key (e.g. darwin-aarch64)
  --repo <owner/repo>     GitHub repository slug
  --skip-build            Skip build and only upload artifacts from target bundle dir
USAGE
}

publish_desktop() {
  local target="$1"
  local platform_key="$2"
  local repo_slug="$3"
  local skip_build="$4"

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

  local version
  version="$(python3 - <<'PY'
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

  if [[ -z "$repo_slug" ]]; then
    local remote_url
    remote_url="$(git remote get-url origin)"
    if [[ "$remote_url" =~ ^git@github.com:([^/]+/[^/]+)(\.git)?$ ]]; then
      repo_slug="${BASH_REMATCH[1]}"
    elif [[ "$remote_url" =~ ^https://github.com/([^/]+/[^/]+)(\.git)?$ ]]; then
      repo_slug="${BASH_REMATCH[1]}"
    else
      echo "error: cannot infer repo slug from origin url: $remote_url" >&2
      echo "hint: pass --repo owner/repo" >&2
      exit 1
    fi
    repo_slug="${repo_slug%.git}"
  fi

  if [[ "$skip_build" != "true" ]]; then
    (
      cd web
      npm ci
      npm run build
    )

    (
      cd desktop
      if [[ -n "$target" ]]; then
        npm run tauri build -- --target "$target"
      else
        npm run tauri build
      fi
    )
  fi

  local -a candidate_bundle_dirs
  if [[ -n "$target" ]]; then
    candidate_bundle_dirs=(
      "desktop/src-tauri/target/${target}/release/bundle"
      "target/${target}/release/bundle"
    )
  else
    candidate_bundle_dirs=(
      "desktop/src-tauri/target/release/bundle"
      "target/release/bundle"
    )
  fi

  local bundle_dir=""
  for dir in "${candidate_bundle_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      bundle_dir="$dir"
      break
    fi
  done

  if [[ -z "$bundle_dir" ]]; then
    echo "error: bundle directory not found. tried:" >&2
    for dir in "${candidate_bundle_dirs[@]}"; do
      echo "  - $dir" >&2
    done
    exit 1
  fi

  local artifact_path=""
  for pattern in "*.app.tar.gz" "*.AppImage.tar.gz" "*.nsis.zip" "*.msi.zip"; do
    candidate="$(find "$bundle_dir" -type f -name "$pattern" | head -1 || true)"
    if [[ -n "$candidate" ]]; then
      artifact_path="$candidate"
      break
    fi
  done

  if [[ -z "$artifact_path" ]]; then
    echo "error: updater archive not found in $bundle_dir" >&2
    exit 1
  fi

  local sig_path="${artifact_path}.sig"
  if [[ ! -f "$sig_path" ]]; then
    echo "error: signature file not found: $sig_path" >&2
    exit 1
  fi

  if [[ -z "$platform_key" ]]; then
    local detect_target="$target"
    if [[ -z "$detect_target" ]]; then
      local sys arch
      sys="$(uname -s)"
      arch="$(uname -m)"
      case "$sys:$arch" in
        Darwin:arm64|Darwin:aarch64) detect_target="aarch64-apple-darwin" ;;
        Darwin:x86_64) detect_target="x86_64-apple-darwin" ;;
        Linux:x86_64) detect_target="x86_64-unknown-linux-gnu" ;;
        Linux:aarch64|Linux:arm64) detect_target="aarch64-unknown-linux-gnu" ;;
        MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) detect_target="x86_64-pc-windows-msvc" ;;
        MINGW*:aarch64|MSYS*:aarch64|CYGWIN*:aarch64) detect_target="aarch64-pc-windows-msvc" ;;
        *) detect_target="" ;;
      esac
    fi

    case "$detect_target" in
      aarch64-apple-darwin) platform_key="darwin-aarch64" ;;
      x86_64-apple-darwin) platform_key="darwin-x86_64" ;;
      x86_64-unknown-linux-gnu) platform_key="linux-x86_64" ;;
      aarch64-unknown-linux-gnu) platform_key="linux-aarch64" ;;
      x86_64-pc-windows-msvc) platform_key="windows-x86_64" ;;
      aarch64-pc-windows-msvc) platform_key="windows-aarch64" ;;
      *)
        echo "error: cannot infer updater platform key. Pass --platform-key" >&2
        exit 1
        ;;
    esac
  fi

  local asset_name asset_url signature
  asset_name="$(basename "$artifact_path")"
  asset_url="https://github.com/${repo_slug}/releases/download/desktop-latest/${asset_name}"
  signature="$(tr -d '\r\n' < "$sig_path")"

  local tmp_dir latest_json_path existing_latest_json_path
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$tmp_dir"'"' EXIT
  latest_json_path="${tmp_dir}/latest.json"
  existing_latest_json_path="${tmp_dir}/latest.existing.json"

  if gh release view desktop-latest --repo "$repo_slug" >/dev/null 2>&1; then
    gh release edit desktop-latest \
      --repo "$repo_slug" \
      --title "Desktop Update Channel" \
      --notes "Automated desktop update channel release (current app version: ${version})"
    gh release download desktop-latest \
      --repo "$repo_slug" \
      --pattern latest.json \
      --dir "$tmp_dir" \
      --clobber >/dev/null 2>&1 || true
    if [[ -f "${tmp_dir}/latest.json" ]]; then
      mv "${tmp_dir}/latest.json" "$existing_latest_json_path"
    fi
  else
    gh release create desktop-latest \
      --repo "$repo_slug" \
      --title "Desktop Update Channel" \
      --notes "Automated desktop update channel release (current app version: ${version})"
  fi

  python3 - <<PY
import datetime
import json
import pathlib

existing_path = pathlib.Path("${existing_latest_json_path}")
payload = {}
if existing_path.exists():
    try:
        payload = json.loads(existing_path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}

platforms = payload.get("platforms")
if not isinstance(platforms, dict):
    platforms = {}

platforms["${platform_key}"] = {
    "signature": "${signature}",
    "url": "${asset_url}",
}

payload["version"] = "v${version}"
payload["notes"] = "Desktop release v${version}"
payload["pub_date"] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
payload["platforms"] = platforms

with open("${latest_json_path}", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

  gh release upload desktop-latest \
    --repo "$repo_slug" \
    "$artifact_path" \
    "$sig_path" \
    "$latest_json_path" \
    --clobber

  echo "Published desktop updater assets to https://github.com/${repo_slug}/releases/tag/desktop-latest"
  echo "Updater endpoint: https://github.com/${repo_slug}/releases/download/desktop-latest/latest.json"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

TAG=""
PUSH_TAG="false"
PUBLISH_DESKTOP="false"
TARGET=""
PLATFORM_KEY=""
REPO_SLUG=""
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH_TAG="true"
      shift
      ;;
    --publish-desktop)
      PUBLISH_DESKTOP="true"
      shift
      ;;
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
      if [[ -z "$TAG" ]]; then
        TAG="$1"
        shift
      else
        echo "error: unknown option or duplicate tag: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "error: missing <tag>" >&2
  usage
  exit 1
fi

if [[ "$TAG" == --* ]]; then
  echo "error: first positional argument must be a tag, got option: $TAG" >&2
  usage
  exit 1
fi

SEMVER_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'
if [[ ! "$TAG" =~ $SEMVER_PATTERN ]]; then
  echo "error: tag must match vX.Y.Z or vX.Y.Z-suffix (received: $TAG)" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: run this script inside the git repository" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  exit 1
fi

echo "Fetching origin/main and tags..."
git fetch --quiet origin main --tags

HEAD_SHA="$(git rev-parse HEAD)"
LOCAL_TAG_EXISTS="false"
REMOTE_TAG_EXISTS="false"
SKIP_TAG_CREATION="false"

if git show-ref --tags --verify --quiet "refs/tags/$TAG"; then
  LOCAL_TAG_EXISTS="true"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  REMOTE_TAG_EXISTS="true"
fi

if [[ "$LOCAL_TAG_EXISTS" == "true" || "$REMOTE_TAG_EXISTS" == "true" ]]; then
  if [[ "$PUBLISH_DESKTOP" != "true" ]]; then
    if [[ "$LOCAL_TAG_EXISTS" == "true" ]]; then
      echo "error: tag already exists locally: $TAG" >&2
    else
      echo "error: tag already exists on origin: $TAG" >&2
    fi
    exit 1
  fi

  if [[ "$LOCAL_TAG_EXISTS" != "true" && "$REMOTE_TAG_EXISTS" == "true" ]]; then
    git fetch --quiet origin "refs/tags/$TAG:refs/tags/$TAG"
  fi

  TAG_COMMIT_SHA="$(git rev-list -n 1 "$TAG")"
  if [[ "$HEAD_SHA" != "$TAG_COMMIT_SHA" ]]; then
    echo "error: tag ${TAG} points to ${TAG_COMMIT_SHA}, but current HEAD is ${HEAD_SHA}." >&2
    echo "hint: checkout the tagged commit before publishing desktop assets (e.g. git checkout ${TAG})." >&2
    exit 1
  fi

  SKIP_TAG_CREATION="true"
  echo "Tag already exists: ${TAG}; skip tag creation and continue desktop publish."
else
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$CURRENT_BRANCH" != "main" ]]; then
    echo "error: current branch must be main when creating a new tag (current: ${CURRENT_BRANCH})." >&2
    exit 1
  fi

  if ! git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
    echo "error: origin/main does not exist." >&2
    exit 1
  fi

  MAIN_SHA="$(git rev-parse "origin/main")"
  if [[ "$HEAD_SHA" != "$MAIN_SHA" ]]; then
    echo "error: HEAD ($HEAD_SHA) is not origin/main ($MAIN_SHA)." >&2
    echo "hint: checkout/update main before cutting a release tag." >&2
    exit 1
  fi

  MESSAGE="zeroclaw $TAG"
  git tag -a "$TAG" -m "$MESSAGE"
  echo "Created annotated tag: $TAG"
fi

if [[ "$SKIP_TAG_CREATION" == "true" ]]; then
  if [[ "$PUSH_TAG" == "true" ]]; then
    echo "Skip pushing tag: already exists."
  fi
elif [[ "$PUSH_TAG" == "true" ]]; then
  git push origin "$TAG"
  echo "Pushed tag to origin: $TAG"
else
  echo "Next step: git push origin $TAG"
fi

if [[ "$PUBLISH_DESKTOP" == "true" ]]; then
  publish_desktop "$TARGET" "$PLATFORM_KEY" "$REPO_SLUG" "$SKIP_BUILD"
fi
