[CmdletBinding()]
param(
  [string]$OpenCodeConfigDir = $env:OPENCODE_CONFIG_DIR
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node is required for OpenUltraCode install."
  exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required. Enable it with 'corepack enable' or install pnpm, then rerun .\install-dev.ps1."
  exit 1
}

if (-not $OpenCodeConfigDir) {
  $OpenCodeConfigDir = Join-Path $HOME ".config\opencode"
}

$repoRoot = $PSScriptRoot
if (-not $repoRoot) {
  $repoRoot = (Get-Location).Path
}

function Get-AgentModel([string]$AgentFile) {
  if (-not (Test-Path $AgentFile)) { return $null }
  $env:AGENT_FILE = $AgentFile
  $model = node -e "const fs = require('node:fs'); const file = process.env.AGENT_FILE; if (!file || !fs.existsSync(file)) process.exit(0); const content = fs.readFileSync(file, 'utf8'); const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]; const model = frontmatter === undefined ? undefined : /^model:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter)?.[1]; const legacyFusionPlaceholders = new Set(['provider/model-a', 'provider/model-b', 'provider/arbiter-model']); const baseModel = model?.replace(/#[^#]+$/, ''); if (baseModel !== undefined && !legacyFusionPlaceholders.has(baseModel)) { process.stdout.write(baseModel + '#max'); }"
  return $model
}

function Restore-AgentModel([string]$AgentFile, [string]$Model) {
  if (-not $Model -or -not (Test-Path $AgentFile)) { return }
  $env:AGENT_FILE = $AgentFile
  $env:AGENT_MODEL = $Model
  node -e "const fs = require('node:fs'); const file = process.env.AGENT_FILE; const model = process.env.AGENT_MODEL; if (!file || !model) throw new Error('missing fusion model restore input'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+#max$/.test(model)) { throw new Error(model + ' must be provider/model#max'); } const content = fs.readFileSync(file, 'utf8'); const baseModel = model.replace(/#[^#]+$/, ''); let updated = content.replace(/^model:[^\r\n]+$/m, 'model: ' + baseModel); updated = /^variant:/m.test(updated) ? updated.replace(/^variant:.*$/m, 'variant: max') : updated.replace(/^model:.*$/m, (line) => line + '\nvariant: max'); fs.writeFileSync(file, updated);"
}

function Register-GlobalPlugin {
  $configFile = Join-Path $OpenCodeConfigDir "opencode.json"
  if (-not (Test-Path $configFile) -and (Test-Path (Join-Path $OpenCodeConfigDir "opencode.jsonc"))) {
    $configFile = Join-Path $OpenCodeConfigDir "opencode.jsonc"
  }
  $pluginPath = (Join-Path $repoRoot ".opencode\plugins\open-ultracode.ts").Replace("\", "/")

  if (-not (Test-Path $OpenCodeConfigDir)) {
    New-Item -ItemType Directory -Path $OpenCodeConfigDir -Force | Out-Null
  }

  if (-not (Test-Path $configFile)) {
    "{\n  `"`$schema`": `"https://opencode.ai/config.json`"\n}\n" | Set-Content -Path $configFile -Encoding utf8
  }

  $env:OPENCODE_GLOBAL_CONFIG = $configFile
  $env:OPENCODE_PLUGIN_PATH = $pluginPath

  node -e "const fs = require('node:fs'); const configPath = process.env.OPENCODE_GLOBAL_CONFIG; const pluginPath = process.env.OPENCODE_PLUGIN_PATH; if (!configPath || !pluginPath) { throw new Error('missing OpenUltraCode installer environment'); } let config = {}; try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) { throw new Error('Could not parse ' + configPath + ': ' + (error instanceof Error ? error.message : String(error))); } if (typeof config !== 'object' || config === null || Array.isArray(config)) { throw new Error(configPath + ' must contain a JSON object'); } config['`$schema'] = config['`$schema'] || 'https://opencode.ai/config.json'; if (config.permission === undefined) { config.permission = { open_ultracode_configure_fusion: 'ask' }; } else if (typeof config.permission === 'object' && config.permission !== null && !Array.isArray(config.permission) && !('open_ultracode_configure_fusion' in config.permission)) { config.permission.open_ultracode_configure_fusion = 'ask'; } const existing = Array.isArray(config.plugin) ? config.plugin : []; config.plugin = existing.filter((entry) => entry !== './.opencode/plugins/open-ultracode.ts'); if (!config.plugin.includes(pluginPath)) { config.plugin.push(pluginPath); } fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');"
}

function Install-GlobalAssets {
  $skillsDir = Join-Path $OpenCodeConfigDir "skills"
  $commandsDir = Join-Path $OpenCodeConfigDir "commands"
  $agentsDir = Join-Path $OpenCodeConfigDir "agents"
  $toolsDir = Join-Path $OpenCodeConfigDir "tools"
  $libDir = Join-Path $OpenCodeConfigDir "lib"

  New-Item -ItemType Directory -Path $skillsDir, $commandsDir, $agentsDir, $toolsDir, $libDir -Force | Out-Null

  $panelAFile = Join-Path $agentsDir "ultracode-fusion-panel-a.md"
  $panelBFile = Join-Path $agentsDir "ultracode-fusion-panel-b.md"
  $arbiterFile = Join-Path $agentsDir "ultracode-fusion-arbiter.md"

  $existingPanelA = Get-AgentModel $panelAFile
  $existingPanelB = Get-AgentModel $panelBFile
  $existingArbiter = Get-AgentModel $arbiterFile

  $targetSkill = Join-Path $skillsDir "open-ultracode"
  if (Test-Path $targetSkill) {
    Remove-Item -Path $targetSkill -Recurse -Force
  }
  Copy-Item -Path (Join-Path $repoRoot ".opencode\skills\open-ultracode") -Destination $targetSkill -Recurse -Force

  Get-ChildItem -Path (Join-Path $repoRoot ".opencode\commands") -Filter "ultracode*.md" | Copy-Item -Destination $commandsDir -Force
  Get-ChildItem -Path (Join-Path $repoRoot ".opencode\commands") -Filter "ultrathink*.md" | Copy-Item -Destination $commandsDir -Force
  Get-ChildItem -Path (Join-Path $repoRoot ".opencode\agents") -Filter "open-ultracode*.md" | Copy-Item -Destination $agentsDir -Force
  Get-ChildItem -Path (Join-Path $repoRoot ".opencode\agents") -Filter "ultracode-fusion*.md" | Copy-Item -Destination $agentsDir -Force
  Copy-Item -Path (Join-Path $repoRoot ".opencode\tools\open_ultracode_configure_fusion.ts") -Destination $toolsDir -Force
  Copy-Item -Path (Join-Path $repoRoot ".opencode\lib\fusion-config.ts") -Destination $libDir -Force

  Restore-AgentModel $panelAFile $existingPanelA
  Restore-AgentModel $panelBFile $existingPanelB
  Restore-AgentModel $arbiterFile $existingArbiter

  Register-GlobalPlugin
}

Push-Location $repoRoot
try {
  pnpm install --frozen-lockfile
  if (Get-Command dagger -ErrorAction SilentlyContinue) {
    pnpm run check
  } else {
    pnpm run build
    pnpm run eslint
    pnpm run test
    pnpm run validate:assets
  }
  Install-GlobalAssets

  if ((Get-Command git -ErrorAction SilentlyContinue) -and (git rev-parse --is-inside-work-tree 2>$null)) {
    git config core.hooksPath .githooks
  }

  Write-Host "OpenUltraCode is installed globally for opencode from this checkout. Restart opencode to load the plugin, commands, skills, and agents."
} finally {
  Pop-Location
}
