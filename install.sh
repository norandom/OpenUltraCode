#!/usr/bin/env sh
set -eu

REPO="norandom/OpenUltraCode"
INSTALL_DIR="${OPENULTRACODE_HOME:-$PWD/OpenUltraCode}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Enable it with 'corepack enable' or install pnpm, then rerun ./install.sh." >&2
    exit 1
  fi
}

install_local() {
  ensure_pnpm
  pnpm install --frozen-lockfile
  pnpm run check

  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git config core.hooksPath .githooks
  fi

  echo "OpenUltraCode is installed. Restart opencode from this project to load the plugin, commands, skills, and agents."
}

download_latest_release() {
  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    echo "Remote install requires curl and tar." >&2
    exit 1
  fi

  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": "\([^"]*\)".*/\1/p' | sed -n '1p')
  if [ -z "$tag" ]; then
    echo "Could not determine latest OpenUltraCode release." >&2
    exit 1
  fi

  tmp_dir=$(mktemp -d)
  archive="$tmp_dir/OpenUltraCode.tar.gz"
  curl -fsSL "https://github.com/$REPO/archive/refs/tags/$tag.tar.gz" -o "$archive"
  tar -xzf "$archive" -C "$tmp_dir"

  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$tmp_dir"/OpenUltraCode-* "$INSTALL_DIR"
  cd "$INSTALL_DIR"
}

if [ -f "package.json" ] && [ -d ".opencode" ]; then
  install_local
else
  download_latest_release
  install_local
fi
