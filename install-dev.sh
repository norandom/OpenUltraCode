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

read_agent_model() {
  agent_file="$1"
  if [ ! -f "$agent_file" ]; then
    return
  fi

  AGENT_FILE="$agent_file" node <<'NODE'
const fs = require("node:fs")

const file = process.env.AGENT_FILE
if (!file) process.exit(0)
const content = fs.readFileSync(file, "utf8")
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
const model = frontmatter === undefined ? undefined : /^model:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter)?.[1]
const legacyFusionPlaceholders = new Set(["provider/model-a", "provider/model-b", "provider/arbiter-model"])
const baseModel = model?.replace(/#[^#]+$/, "")
if (baseModel !== undefined && !legacyFusionPlaceholders.has(baseModel)) {
  process.stdout.write(`${baseModel}#max`)
}
NODE
}

restore_agent_model() {
  agent_file="$1"
  model="$2"
  if [ -z "$model" ]; then
    return
  fi

  AGENT_FILE="$agent_file" AGENT_MODEL="$model" node <<'NODE'
const fs = require("node:fs")

const file = process.env.AGENT_FILE
const model = process.env.AGENT_MODEL
if (!file || !model) throw new Error("missing fusion model restore input")
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+#max$/.test(model)) {
  throw new Error(`${model} must be provider/model#max`)
}
const content = fs.readFileSync(file, "utf8")
const baseModel = model.replace(/#[^#]+$/, "")
let updated = content.replace(/^model:[^\r\n]+$/m, `model: ${baseModel}`)
updated = /^variant:/m.test(updated)
  ? updated.replace(/^variant:.*$/m, "variant: max")
  : updated.replace(/^model:.*$/m, (line) => `${line}\nvariant: max`)
fs.writeFileSync(file, updated)
NODE
}

install_global_assets() {
  mkdir -p "$OPENCODE_CONFIG_DIR/skills" "$OPENCODE_CONFIG_DIR/commands" "$OPENCODE_CONFIG_DIR/agents" "$OPENCODE_CONFIG_DIR/tools" "$OPENCODE_CONFIG_DIR/lib"

  existing_panel_a=$(read_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-a.md" || true)
  existing_panel_b=$(read_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-b.md" || true)
  existing_arbiter=$(read_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-arbiter.md" || true)

  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp -R ".opencode/skills/open-ultracode" "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp .opencode/commands/ultracode*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp .opencode/commands/ultrathink*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp .opencode/agents/open-ultracode*.md "$OPENCODE_CONFIG_DIR/agents/"
  cp .opencode/agents/ultracode-fusion*.md "$OPENCODE_CONFIG_DIR/agents/"
  cp .opencode/tools/open_ultracode_configure_fusion.ts "$OPENCODE_CONFIG_DIR/tools/"
  cp .opencode/lib/fusion-config.ts "$OPENCODE_CONFIG_DIR/lib/"

  restore_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-a.md" "$existing_panel_a"
  restore_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-b.md" "$existing_panel_b"
  restore_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-arbiter.md" "$existing_arbiter"

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
if (config.permission === undefined) {
  config.permission = { open_ultracode_configure_fusion: "ask" }
} else if (
  typeof config.permission === "object" &&
  config.permission !== null &&
  !Array.isArray(config.permission) &&
  !("open_ultracode_configure_fusion" in config.permission)
) {
  config.permission.open_ultracode_configure_fusion = "ask"
}
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
