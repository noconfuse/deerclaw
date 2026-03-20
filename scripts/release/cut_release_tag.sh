#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/release/cut_release_tag.sh <tag> [--push] [--publish-desktop]

Create an annotated release tag from the current checkout.

Requirements:
- tag must match vX.Y.Z (optional suffix like -rc.1)
- working tree must be clean
- HEAD must match origin/main
- tag must not already exist locally or on origin

Options:
  --push              Push the tag to origin after creating it
  --publish-desktop   Run scripts/release/publish_desktop_local.sh after tagging
USAGE
}

if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage
  exit 1
fi

TAG=""
PUSH_TAG="false"
PUBLISH_DESKTOP="false"

for arg in "$@"; do
  case "$arg" in
    --push)
      PUSH_TAG="true"
      ;;
    --publish-desktop)
      PUBLISH_DESKTOP="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$TAG" ]]; then
        TAG="$arg"
      else
        echo "error: unknown option or duplicate tag: $arg" >&2
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

if [[ "$PUBLISH_DESKTOP" == "true" ]]; then
  if [[ ! -f "scripts/release/publish_desktop_local.sh" ]]; then
    echo "error: missing script scripts/release/publish_desktop_local.sh" >&2
    usage
    exit 1
  fi
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
MAIN_SHA="$(git rev-parse origin/main)"
if [[ "$HEAD_SHA" != "$MAIN_SHA" ]]; then
  echo "error: HEAD ($HEAD_SHA) is not origin/main ($MAIN_SHA)." >&2
  echo "hint: checkout/update main before cutting a release tag." >&2
  exit 1
fi

if git show-ref --tags --verify --quiet "refs/tags/$TAG"; then
  echo "error: tag already exists locally: $TAG" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: tag already exists on origin: $TAG" >&2
  exit 1
fi

MESSAGE="zeroclaw $TAG"
git tag -a "$TAG" -m "$MESSAGE"
echo "Created annotated tag: $TAG"

if [[ "$PUSH_TAG" == "true" ]]; then
  git push origin "$TAG"
  echo "Pushed tag to origin: $TAG"
else
  echo "Next step: git push origin $TAG"
fi

if [[ "$PUBLISH_DESKTOP" == "true" ]]; then
  bash scripts/release/publish_desktop_local.sh
fi
