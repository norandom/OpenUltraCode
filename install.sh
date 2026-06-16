#!/usr/bin/env sh
set -eu

REPO="norandom/OpenUltraCode"
INSTALL_DIR="${OPENULTRACODE_HOME:-$HOME/.local/share/open-ultracode}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
DEFAULT_FUSION_MODEL="openai/gpt-5"

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required for OpenUltraCode install." >&2
    exit 1
  fi
}

read_current_model() {
  config_file="$OPENCODE_CONFIG_DIR/opencode.json"
  if [ ! -f "$config_file" ] || ! command -v node >/dev/null 2>&1; then
    return
  fi

  OPENCODE_GLOBAL_CONFIG="$config_file" node <<'NODE'
const fs = require("node:fs")

try {
  const config = JSON.parse(fs.readFileSync(process.env.OPENCODE_GLOBAL_CONFIG, "utf8"))
  if (typeof config.model === "string" && config.model.length > 0) {
    process.stdout.write(config.model)
  }
} catch {
  process.exit(0)
}
NODE
}

select_from_menu() {
  prompt="$1"
  default_value="$2"
  current_model="$3"

  choices="$default_value"
  if [ -n "$current_model" ] && [ "$current_model" != "$default_value" ]; then
    choices="$choices
$current_model"
  fi
  choices="$choices
Custom model ID"

  if [ ! -t 0 ] || [ ! -t 2 ]; then
    printf '%s' "$default_value"
    return
  fi

  OPENCODE_MENU_PROMPT="$prompt" OPENCODE_MENU_CHOICES="$choices" node -e '
const readline = require("node:readline")

const prompt = process.env.OPENCODE_MENU_PROMPT ?? "Choose"
const choices = (process.env.OPENCODE_MENU_CHOICES ?? "").split("\n").filter(Boolean)
let index = 0

readline.emitKeypressEvents(process.stdin)
if (process.stdin.isTTY) process.stdin.setRawMode(true)

function render() {
  process.stderr.write("\x1b[?25l")
  process.stderr.write("\x1b[2K\r")
  process.stderr.write(`${prompt}\n`)
  for (let i = 0; i < choices.length; i += 1) {
    process.stderr.write(`${i === index ? ">" : " "} ${choices[i]}\n`)
  }
  process.stderr.write(`\x1b[${choices.length + 1}A`)
}

function cleanup() {
  process.stderr.write(`\x1b[${choices.length + 1}B`)
  process.stderr.write("\x1b[?25h")
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
}

render()
process.stdin.on("keypress", (_str, key) => {
  if (key.name === "up") index = (index + choices.length - 1) % choices.length
  if (key.name === "down") index = (index + 1) % choices.length
  if (key.name === "return") {
    cleanup()
    process.stdout.write(`${choices[index]}\n`)
    process.exit(0)
  }
  if (key.ctrl && key.name === "c") {
    cleanup()
    process.exit(130)
  }
  render()
})
'
}

choose_model() {
  prompt="$1"
  current_model="$2"
  selected=$(select_from_menu "$prompt" "$DEFAULT_FUSION_MODEL" "$current_model")
  if [ "$selected" = "Custom model ID" ]; then
    printf '%s: ' "$prompt" >&2
    IFS= read -r selected
  fi
  if [ -z "$selected" ]; then
    selected="$DEFAULT_FUSION_MODEL"
  fi
  printf '%s' "$selected"
}

download_latest_release() {
  need_command curl
  need_command tar
  need_command mktemp

  tmp_dir=$(mktemp -d)
  archive="$tmp_dir/open-ultracode-release.tar.gz"
  if ! curl -fsSL "https://github.com/$REPO/releases/latest/download/open-ultracode-release.tar.gz" -o "$archive"; then
    echo "Could not download the latest OpenUltraCode release asset." >&2
    exit 1
  fi

  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$archive" -C "$INSTALL_DIR"
}

install_global_assets() {
  mkdir -p "$OPENCODE_CONFIG_DIR/skills" "$OPENCODE_CONFIG_DIR/commands" "$OPENCODE_CONFIG_DIR/agents"

  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp -R "$INSTALL_DIR/.opencode/skills/open-ultracode" "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp "$INSTALL_DIR"/.opencode/commands/ultracode*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp "$INSTALL_DIR"/.opencode/commands/ultrathink*.md "$OPENCODE_CONFIG_DIR/commands/"
  cp "$INSTALL_DIR"/.opencode/agents/open-ultracode*.md "$OPENCODE_CONFIG_DIR/agents/"
  cp "$INSTALL_DIR"/.opencode/agents/ultracode-fusion*.md "$OPENCODE_CONFIG_DIR/agents/"

  configure_fusion_models
  register_global_plugin
}

configure_fusion_models() {
  current_model=$(read_current_model || true)
  panel_a=$(choose_model "Choose fusion panel A model" "$current_model")
  panel_b=$(choose_model "Choose fusion panel B model" "$current_model")
  arbiter=$(choose_model "Choose fusion arbiter model" "$current_model")

  replace_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-a.md" "$panel_a"
  replace_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-panel-b.md" "$panel_b"
  replace_agent_model "$OPENCODE_CONFIG_DIR/agents/ultracode-fusion-arbiter.md" "$arbiter"
}

replace_agent_model() {
  file="$1"
  model="$2"
  if [ ! -f "$file" ]; then
    echo "Missing fusion agent file: $file" >&2
    exit 1
  fi
  AGENT_FILE="$file" AGENT_MODEL="$model" node <<'NODE'
const fs = require("node:fs")

const file = process.env.AGENT_FILE
const model = process.env.AGENT_MODEL
if (!file || !model) throw new Error("missing agent model replacement input")
const content = fs.readFileSync(file, "utf8")
if (!/^model: .+$/m.test(content)) throw new Error(`${file} does not contain model frontmatter`)
fs.writeFileSync(file, content.replace(/^model: .+$/m, `model: ${model}`))
NODE
}

register_global_plugin() {
  config_file="$OPENCODE_CONFIG_DIR/opencode.json"
  plugin_path="$INSTALL_DIR/.opencode/plugins/open-ultracode.ts"
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

need_command node
download_latest_release
install_global_assets

echo "OpenUltraCode is installed globally for opencode. Restart opencode to load the plugin, commands, skills, and agents."
