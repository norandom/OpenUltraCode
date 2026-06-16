#!/usr/bin/env sh
set -eu

OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Enable it with 'corepack enable' or install pnpm, then rerun ./install-dev.sh." >&2
    exit 1
  fi
}

install_global_assets() {
  mkdir -p "$OPENCODE_CONFIG_DIR/skills" "$OPENCODE_CONFIG_DIR/commands" "$OPENCODE_CONFIG_DIR/agents"

  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp -R ".opencode/skills/open-ultracode" "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp .opencode/commands/ultracode*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp .opencode/commands/ultrathink*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp .opencode/agents/open-ultracode*.md "$OPENCODE_CONFIG_DIR/agents/"
  cp .opencode/agents/ultracode-fusion*.md "$OPENCODE_CONFIG_DIR/agents/"

  register_global_plugin
}

register_global_plugin() {
  config_file="$OPENCODE_CONFIG_DIR/opencode.json"
  plugin_path="$(pwd -P)/.opencode/plugins/open-ultracode.ts"
  mkdir -p "$OPENCODE_CONFIG_DIR"

  if [ ! -f "$config_file" ]; then
    printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' >"$config_file"
  fi

  OPENCODE_GLOBAL_CONFIG="$config_file" OPENCODE_PLUGIN_PATH="$plugin_path" node <<'NODE'
const fs = require("node:fs")

const configPath = process.env.OPENCODE_GLOBAL_CONFIG
const pluginPath = process.env.OPENCODE_PLUGIN_PATH
if (!configPath || !pluginPath) {
  throw new Error("missing OpenUltraCode installer environment")
}

let config = {}
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"))
} catch (error) {
  throw new Error(`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
}

if (typeof config !== "object" || config === null || Array.isArray(config)) {
  throw new Error(`${configPath} must contain a JSON object`)
}

config.$schema ??= "https://opencode.ai/config.json"
const existing = Array.isArray(config.plugin) ? config.plugin : []
config.plugin = existing.filter((entry) => entry !== "./.opencode/plugins/open-ultracode.ts")
if (!config.plugin.includes(pluginPath)) {
  config.plugin.push(pluginPath)
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
NODE
}

ensure_pnpm
pnpm install --frozen-lockfile
pnpm run check
install_global_assets

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git config core.hooksPath .githooks
fi

echo "OpenUltraCode is installed globally for opencode from this checkout. Restart opencode to load the plugin, commands, skills, and agents."
