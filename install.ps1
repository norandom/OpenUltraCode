[CmdletBinding()]
param(
  [string]$OpenCodeConfigDir = $env:OPENCODE_CONFIG_DIR,
  [string]$InstallDir = $env:OPENULTRACODE_HOME,
  [string]$Repo = "norandom/OpenUltraCode",
  [string]$PanelA,
  [string]$PanelB,
  [string]$Decider,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node is required for OpenUltraCode install."
  exit 1
}

if (-not $OpenCodeConfigDir) {
  $OpenCodeConfigDir = Join-Path $HOME ".config\opencode"
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $HOME ".local\share\open-ultracode"
}

$DefaultFusionPanelAModel = "opencode/deepseek-v4-pro#max"
$DefaultFusionPanelBModel = "opencode/glm-5.2#max"
$DefaultFusionArbiterModel = "opencode/kimi-k3#max"

function Get-AgentModel([string]$AgentFile) {
  if (-not (Test-Path $AgentFile)) { return $null }
  $env:AGENT_FILE = $AgentFile
  $model = node -e "const fs = require('node:fs'); const file = process.env.AGENT_FILE; if (!file || !fs.existsSync(file)) process.exit(0); const content = fs.readFileSync(file, 'utf8'); const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]; const model = frontmatter === undefined ? undefined : /^model:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter)?.[1]; const legacyFusionPlaceholders = new Set(['provider/model-a', 'provider/model-b', 'provider/arbiter-model']); const baseModel = model?.replace(/#[^#]+$/, ''); if (baseModel !== undefined && !legacyFusionPlaceholders.has(baseModel)) { process.stdout.write(baseModel + '#max'); }"
  return $model
}

function Set-AgentModel([string]$AgentFile, [string]$Model) {
  if (-not (Test-Path $AgentFile)) {
    Write-Error "Missing fusion agent file: $AgentFile"
    exit 1
  }
  $env:AGENT_FILE = $AgentFile
  $env:AGENT_MODEL = $Model
  node -e "const fs = require('node:fs'); const file = process.env.AGENT_FILE; const model = process.env.AGENT_MODEL; if (!file || !model) throw new Error('missing agent model replacement input'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+(?:#max)?$/.test(model)) { throw new Error(model + ' must be provider/model or provider/model#max'); } const content = fs.readFileSync(file, 'utf8'); if (!/^model: .+$/m.test(content)) throw new Error(file + ' does not contain model frontmatter'); const baseModel = model.replace(/#[^#]+$/, ''); let updated = content.replace(/^model: .+$/m, 'model: ' + baseModel); updated = /^variant:/m.test(updated) ? updated.replace(/^variant:.*$/m, 'variant: max') : updated.replace(/^model:.*$/m, (line) => line + '\nvariant: max'); fs.writeFileSync(file, updated);"
}

function Download-LatestRelease {
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("open-ultracode-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $archive = Join-Path $tempDir "open-ultracode-release.tar.gz"

  $releaseUrl = "https://github.com/$Repo/releases/latest/download/open-ultracode-release.tar.gz"
  Write-Host "Downloading latest OpenUltraCode release from $releaseUrl..."
  try {
    Invoke-WebRequest -Uri $releaseUrl -OutFile $archive
  } catch {
    Write-Error "Could not download the latest OpenUltraCode release asset from $releaseUrl: $_"
    exit 1
  }

  if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  if (Get-Command tar -ErrorAction SilentlyContinue) {
    tar -xzf $archive -C $InstallDir
  } else {
    Write-Error "tar is required to extract release archive."
    exit 1
  }

  Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Register-GlobalPlugin {
  $configFile = Join-Path $OpenCodeConfigDir "opencode.json"
  if (-not (Test-Path $configFile) -and (Test-Path (Join-Path $OpenCodeConfigDir "opencode.jsonc"))) {
    $configFile = Join-Path $OpenCodeConfigDir "opencode.jsonc"
  }
  $pluginPath = (Join-Path $InstallDir ".opencode\plugins\open-ultracode.ts").Replace("\", "/")

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
  Copy-Item -Path (Join-Path $InstallDir ".opencode\skills\open-ultracode") -Destination $targetSkill -Recurse -Force

  Get-ChildItem -Path (Join-Path $InstallDir ".opencode\commands") -Filter "ultracode*.md" | Copy-Item -Destination $commandsDir -Force
  Get-ChildItem -Path (Join-Path $InstallDir ".opencode\commands") -Filter "ultrathink*.md" | Copy-Item -Destination $commandsDir -Force
  Get-ChildItem -Path (Join-Path $InstallDir ".opencode\agents") -Filter "open-ultracode*.md" | Copy-Item -Destination $agentsDir -Force
  Get-ChildItem -Path (Join-Path $InstallDir ".opencode\agents") -Filter "ultracode-fusion*.md" | Copy-Item -Destination $agentsDir -Force
  Copy-Item -Path (Join-Path $InstallDir ".opencode\tools\open_ultracode_configure_fusion.ts") -Destination $toolsDir -Force
  Copy-Item -Path (Join-Path $InstallDir ".opencode\lib\fusion-config.ts") -Destination $libDir -Force

  $chosenPanelA = if ($PanelA) { $PanelA } elseif ($existingPanelA) { $existingPanelA } else { $DefaultFusionPanelAModel }
  $chosenPanelB = if ($PanelB) { $PanelB } elseif ($existingPanelB) { $existingPanelB } else { $DefaultFusionPanelBModel }
  $chosenArbiter = if ($Decider) { $Decider } elseif ($existingArbiter) { $existingArbiter } else { $DefaultFusionArbiterModel }

  Set-AgentModel $panelAFile $chosenPanelA
  Set-AgentModel $panelBFile $chosenPanelB
  Set-AgentModel $arbiterFile $chosenArbiter

  Register-GlobalPlugin
}

Download-LatestRelease
Install-GlobalAssets

Write-Host "OpenUltraCode is installed globally for opencode. Restart opencode to load the plugin, commands, skills, and agents."
