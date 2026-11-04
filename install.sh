#!/usr/bin/env sh
set -eu
# Model IDs and paths are never meant to be glob patterns.
set -f

REPO="norandom/OpenUltraCode"
: "${HOME:?HOME must be set}"
INSTALL_DIR="${OPENULTRACODE_HOME:-$HOME/.local/share/open-ultracode}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
RELEASE_URL="https://github.com/$REPO/releases/latest/download/open-ultracode-release.tar.gz"

# Files OpenUltraCode ships; tests/installer-assets.test.ts keeps these lists in sync with .opencode.
SHIPPED_COMMANDS="ultracode-debug.md ultracode-fusion-models.md ultracode-fusion.md ultracode-research.md ultracode-spec-audit.md ultracode-verify.md ultracode.md ultrathink-fusion.md ultrathink.md"
SHIPPED_AGENTS="open-ultracode-adversary.md open-ultracode-implementer.md open-ultracode-planner.md open-ultracode-reconciler.md open-ultracode-researcher.md open-ultracode-verifier.md open-ultracode.md ultracode-fusion-arbiter.md ultracode-fusion-panel-a.md ultracode-fusion-panel-b.md"
FUSION_AGENTS="ultracode-fusion-panel-a.md ultracode-fusion-panel-b.md ultracode-fusion-arbiter.md"

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

Installs the latest OpenUltraCode release for opencode.
Options:
  -remove, --remove, -r   Remove OpenUltraCode from opencode instead of installing.
  --non-interactive       Do not prompt; keep installed fusion models or use the shipped defaults.
  --verify                Also dispatch every fusion agent once through opencode (a few tiny model calls).
  --skip-runtime-check    Do not reload opencode or check the installation against it.
  --panel-a <model>       Fusion panel A model (provider/model or provider/model#max).
  --panel-b <model>       Fusion panel B model.
  --decider <model>       Fusion arbiter model.
  --archive <file>        Install from a local release archive instead of downloading it.
  -h, --help              Show this help.
USAGE
}

fail() {
  echo "OpenUltraCode: $*" >&2
  exit 1
}

REMOVE=0
NON_INTERACTIVE=0
RUNTIME_CHECK=static
ARCHIVE=""
PANEL_A=""
PANEL_B=""
DECIDER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -remove|--remove|-r) REMOVE=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    --verify) RUNTIME_CHECK=live ;;
    --skip-runtime-check) RUNTIME_CHECK=skip ;;
    --panel-a|--panel-b|--decider|--archive)
      [ "$#" -ge 2 ] || fail "$1 needs a value"
      case "$1" in
        --panel-a) PANEL_A="$2" ;;
        --panel-b) PANEL_B="$2" ;;
        --decider) DECIDER="$2" ;;
        --archive) ARCHIVE="$2" ;;
      esac
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

INSTALLER_LIB="$INSTALL_DIR/scripts/installer-lib.mjs"
MODEL_MENU="$INSTALL_DIR/scripts/model-menu.mjs"

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required for OpenUltraCode install."
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

agent_override() {
  case "$1" in
    ultracode-fusion-panel-a.md) printf '%s' "$PANEL_A" ;;
    ultracode-fusion-panel-b.md) printf '%s' "$PANEL_B" ;;
    *) printf '%s' "$DECIDER" ;;
  esac
}

# Prints the chosen model. Always called as $(choose_model ...) || exit $? because bash
# does not apply set -e inside command substitutions. The menu reads /dev/tty so it
# also works when this script itself arrives on stdin (curl | sh).
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
# model leaves the existing configuration untouched.
resolve_fusion_models() {
  source_agents="$1"
  RESOLVED_MODELS=""
  DETECTED_MODELS=""
  if has_tty; then
    DETECTED_MODELS=$(detect_opencode_models)
  fi
  for agent in $FUSION_AGENTS; do
    model=$(agent_override "$agent")
    if [ -z "$model" ]; then
      default_model=$(lib get-agent-model "$source_agents/$agent") || exit $?
      [ -n "$default_model" ] || fail "shipped agent $agent has no default model"
      current_model=$(lib get-agent-model "$OPENCODE_CONFIG_DIR/agents/$agent") || exit $?
      model=$(choose_model "$(agent_prompt "$agent")" "${current_model:-$default_model}") || exit $?
    fi
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

is_install_dir() {
  [ -d "$1/.opencode/plugins/open-ultracode" ] && [ -f "$1/scripts/installer-lib.mjs" ]
}

TMP_DIR=""
STAGE_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
  if [ -n "$STAGE_DIR" ]; then rm -rf "$STAGE_DIR"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Downloads and verifies the release next to INSTALL_DIR, then swaps it in. Any failure
# leaves the existing installation (which opencode.json points at) unchanged.
install_latest_release() {
  need_command tar
  need_command mktemp
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ] && [ ! -d "$INSTALL_DIR/.opencode/plugins/open-ultracode" ]; then
    fail "refusing to replace $INSTALL_DIR because it is not an OpenUltraCode installation. Set OPENULTRACODE_HOME to another directory."
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  TMP_DIR=$(mktemp -d)
  STAGE_DIR=$(mktemp -d "$INSTALL_DIR.new-XXXXXX")
  archive="$TMP_DIR/open-ultracode-release.tar.gz"

  if [ -n "$ARCHIVE" ]; then
    cp "$ARCHIVE" "$archive"
  else
    need_command curl
    echo "Downloading latest OpenUltraCode release from $RELEASE_URL..."
    curl -fsSL --retry 3 --connect-timeout 20 "$RELEASE_URL" -o "$archive" ||
      fail "could not download the latest OpenUltraCode release asset."
  fi
  tar -xzf "$archive" -C "$STAGE_DIR" || fail "could not extract the release archive; the existing installation was left unchanged."
  is_install_dir "$STAGE_DIR" || fail "the release archive is incomplete; the existing installation was left unchanged."

  previous=""
  if [ -e "$INSTALL_DIR" ]; then
    previous="$INSTALL_DIR.old-$$"
    mv "$INSTALL_DIR" "$previous"
  fi
  mv "$STAGE_DIR" "$INSTALL_DIR"
  STAGE_DIR=""
  if [ -n "$previous" ]; then
    rm -rf "$previous"
  fi
}

# Makes the running opencode pick up the install (`opencode reload`), then checks the REAL
# installation: the coordinator and every fusion agent must name a provider, model, and variant
# that opencode offers.
verify_runtime() {
  source_dir="$1"
  if [ "$RUNTIME_CHECK" = "skip" ]; then
    echo "OpenUltraCode: runtime check skipped (--skip-runtime-check)."
    return 0
  fi
  if ! command -v opencode >/dev/null 2>&1; then
    echo "OpenUltraCode: opencode is not on PATH; skipped the runtime check." >&2
    return 0
  fi
  opencode reload >/dev/null 2>&1 || echo "OpenUltraCode: 'opencode reload' failed; restart opencode to load the changes." >&2
  check_status=0
  if [ "$RUNTIME_CHECK" = "live" ]; then
    node "$source_dir/scripts/runtime-check.mjs" --config-dir "$OPENCODE_CONFIG_DIR" --live || check_status=$?
  else
    node "$source_dir/scripts/runtime-check.mjs" --config-dir "$OPENCODE_CONFIG_DIR" || check_status=$?
  fi
  if [ "$check_status" -eq 1 ]; then
    fail "the runtime check found problems (see above). Fix them with --panel-a/--panel-b/--decider or /ultracode-fusion-models."
  fi
  if [ "$check_status" -ne 0 ]; then
    echo "OpenUltraCode: the runtime check could not reach opencode; run 'node $source_dir/scripts/runtime-check.mjs' after starting it." >&2
  fi
}

remove_legacy_global_files() {
  # OpenCode 2 does not load ~/.config/opencode/tools; the plugin registers the fusion tool itself.
  rm -f "$OPENCODE_CONFIG_DIR/tools/open_ultracode_configure_fusion.ts" "$OPENCODE_CONFIG_DIR/lib/fusion-config.ts"
}

install_global_assets() {
  source_dir="$1"
  resolve_fusion_models "$source_dir/assets/agents"

  mkdir -p "$OPENCODE_CONFIG_DIR/skills" "$OPENCODE_CONFIG_DIR/commands" "$OPENCODE_CONFIG_DIR/agents"
  rm -rf "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  cp -R "$source_dir/.opencode/skills/open-ultracode" "$OPENCODE_CONFIG_DIR/skills/open-ultracode"
  for name in $SHIPPED_COMMANDS; do
    cp "$source_dir/.opencode/commands/$name" "$OPENCODE_CONFIG_DIR/commands/$name"
  done
  for name in $SHIPPED_AGENTS; do
    cp "$source_dir/assets/agents/$name" "$OPENCODE_CONFIG_DIR/agents/$name"
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

need_command node

if [ "$REMOVE" -eq 1 ]; then
  [ -f "$INSTALLER_LIB" ] || fail "$INSTALL_DIR does not contain an OpenUltraCode installation. Set OPENULTRACODE_HOME, or reinstall and then run --remove."
  remove_global_assets
  if is_install_dir "$INSTALL_DIR"; then
    rm -rf "$INSTALL_DIR"
  fi
  echo "OpenUltraCode has been removed from opencode. Restart opencode to unload the plugin, commands, skills, and agents."
  exit 0
fi

for model in "$PANEL_A" "$PANEL_B" "$DECIDER"; do
  if [ -n "$model" ]; then
    printf '%s' "$model" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*/[^[:space:]#]+(#max)?$' ||
      fail "$model must be provider/model or provider/model#max"
  fi
done

install_latest_release
install_global_assets "$INSTALL_DIR"
verify_runtime "$INSTALL_DIR"

# Show what is actually installed, read back from disk.
echo
lib summary --config-dir "$OPENCODE_CONFIG_DIR" --source-dir "$INSTALL_DIR"
