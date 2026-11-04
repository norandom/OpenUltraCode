#!/usr/bin/env sh
set -eu
# Model IDs and paths are never meant to be glob patterns.
set -f

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
cd "$REPO_ROOT"
: "${HOME:?HOME must be set}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
INSTALLER_LIB="$REPO_ROOT/scripts/installer-lib.mjs"
MODEL_MENU="$REPO_ROOT/scripts/model-menu.mjs"

# Files OpenUltraCode ships; tests/installer-assets.test.ts keeps these lists in sync with .opencode.
SHIPPED_COMMANDS="ultracode-debug.md ultracode-fusion-models.md ultracode-fusion.md ultracode-research.md ultracode-spec-audit.md ultracode-verify.md ultracode.md ultrathink-fusion.md ultrathink.md"
SHIPPED_AGENTS="open-ultracode-adversary.md open-ultracode-implementer.md open-ultracode-planner.md open-ultracode-reconciler.md open-ultracode-researcher.md open-ultracode-verifier.md open-ultracode.md ultracode-fusion-arbiter.md ultracode-fusion-panel-a.md ultracode-fusion-panel-b.md"
FUSION_AGENTS="ultracode-fusion-panel-a.md ultracode-fusion-panel-b.md ultracode-fusion-arbiter.md"

usage() {
  cat <<'USAGE'
Usage: install-dev.sh [--remove] [--non-interactive] [--skip-checks] [-h|--help]

Installs OpenUltraCode for opencode from this checkout.
Options:
  -remove, --remove, -r   Remove OpenUltraCode from opencode instead of installing.
  --non-interactive       Do not prompt; keep installed fusion models or use the shipped defaults.
  --skip-checks           Skip pnpm install and pnpm run check.
  -h, --help              Show this help.
USAGE
}

REMOVE=0
NON_INTERACTIVE=0
SKIP_CHECKS=0
for arg in "$@"; do
  case "$arg" in
    -remove|--remove|-r) REMOVE=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

fail() {
  echo "OpenUltraCode: $*" >&2
  exit 1
}

lib() {
  node "$INSTALLER_LIB" "$@"
}

# Your providers' models first, then opencode's hosted catalog; see list-models in
# scripts/installer-lib.mjs (it retries `opencode models` and adds models from your config).
detect_opencode_models() {
  lib list-models --config-dir "$OPENCODE_CONFIG_DIR" || true
}

has_tty() {
  [ "$NON_INTERACTIVE" -eq 0 ] && (: </dev/tty >/dev/tty) 2>/dev/null
}

agent_prompt() {
  case "$1" in
    ultracode-fusion-panel-a.md) echo "Choose fusion panel A model" ;;
    ultracode-fusion-panel-b.md) echo "Choose fusion panel B model" ;;
    *) echo "Choose fusion arbiter model" ;;
  esac
}

# Prints the chosen model. Always called as $(choose_model ...) || exit $? because bash
# does not apply set -e inside command substitutions.
choose_model() {
  if ! has_tty; then
    printf '%s: using %s\n' "$1" "$2" >&2
    printf '%s' "$2"
    return 0
  fi
  # shellcheck disable=SC2086 # one detected model per word
  node "$MODEL_MENU" "$1" "$2" $DETECTED_MODELS </dev/tty 2>/dev/tty || return $?
}

# Chooses every fusion model before anything is copied, so a cancelled menu or an invalid
# model leaves the existing installation untouched.
resolve_fusion_models() {
  source_agents="$1"
  RESOLVED_MODELS=""
  DETECTED_MODELS=""
  if has_tty; then
    DETECTED_MODELS=$(detect_opencode_models)
  fi
  for agent in $FUSION_AGENTS; do
    default_model=$(lib get-agent-model "$source_agents/$agent") || exit $?
    [ -n "$default_model" ] || fail "shipped agent $agent has no default model"
    current_model=$(lib get-agent-model "$OPENCODE_CONFIG_DIR/agents/$agent") || exit $?
    model=$(choose_model "$(agent_prompt "$agent")" "${current_model:-$default_model}") || exit $?
    lib validate-model "$model"
    RESOLVED_MODELS="$RESOLVED_MODELS $agent=$model"
  done
}

model_for() {
  for pair in $RESOLVED_MODELS; do
    case "$pair" in
      "$1="*) printf '%s' "${pair#*=}" ;;
    esac
  done
}

remove_legacy_global_files() {
  # OpenCode 2 does not load ~/.config/opencode/tools; the plugin registers the fusion tool itself.
  rm -f "$OPENCODE_CONFIG_DIR/tools/open_ultracode_configure_fusion.ts" "$OPENCODE_CONFIG_DIR/lib/fusion-config.ts"
}

install_global_assets() {
  source_dir="$1"
  resolve_fusion_models "$source_dir/.opencode/agents"

  mkdir -p "$OPENCODE_CONFIG_DIR/skills" "$OPENCODE_CONFIG_DIR/commands" "$OPENCODE_CONFIG_DIR/agents"
  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp -R "$source_dir/.opencode/skills/open-ultracode" "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  for name in $SHIPPED_COMMANDS; do
    cp "$source_dir/.opencode/commands/$name" "$OPENCODE_CONFIG_DIR/commands/$name"
  done
  for name in $SHIPPED_AGENTS; do
    cp "$source_dir/.opencode/agents/$name" "$OPENCODE_CONFIG_DIR/agents/$name"
  done
  for agent in $FUSION_AGENTS; do
    lib set-agent-model "$OPENCODE_CONFIG_DIR/agents/$agent" "$(model_for "$agent")"
  done
  remove_legacy_global_files

  lib register --config-dir "$OPENCODE_CONFIG_DIR" --plugin-path "$source_dir/.opencode/plugins/open-ultracode"
}

remove_global_assets() {
  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  # Remove only the files OpenUltraCode ships, never a user's own ultracode-* agents or commands.
  for name in $SHIPPED_COMMANDS; do
    rm -f "$OPENCODE_CONFIG_DIR/commands/$name"
  done
  for name in $SHIPPED_AGENTS; do
    rm -f "$OPENCODE_CONFIG_DIR/agents/$name"
  done
  remove_legacy_global_files
  lib unregister --config-dir "$OPENCODE_CONFIG_DIR"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable || echo "OpenUltraCode: 'corepack enable' failed" >&2
  fi
  command -v pnpm >/dev/null 2>&1 || fail "pnpm is required. Enable it with 'corepack enable' or install pnpm, then rerun ./install-dev.sh."
}

enable_git_hooks() {
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git config core.hooksPath .githooks
  fi
}

command -v node >/dev/null 2>&1 || fail "node is required for OpenUltraCode install."

if [ "$REMOVE" -eq 1 ]; then
  remove_global_assets
  echo "OpenUltraCode has been removed from opencode. Restart opencode to unload the plugin, commands, skills, and agents. This checkout was left in place."
  exit 0
fi

if [ "$SKIP_CHECKS" -eq 0 ]; then
  ensure_pnpm
  pnpm install --frozen-lockfile
  pnpm run check
fi
install_global_assets "$REPO_ROOT"
enable_git_hooks

echo "OpenUltraCode is installed globally for opencode from this checkout. Restart opencode to load the plugin, commands, skills, and agents."
