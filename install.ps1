[CmdletBinding()]
param(
  [string]$OpenCodeConfigDir = $env:OPENCODE_CONFIG_DIR,
  [string]$InstallDir = $env:OPENULTRACODE_HOME,
  [string]$Repo = "norandom/OpenUltraCode",
  [string]$PanelA,
  [string]$PanelB,
  [string]$Decider,
  [string]$Archive,
  [switch]$NonInteractive,
  [switch]$Verify,
  [switch]$SkipRuntimeCheck,
  [switch]$Remove
)

# This script also runs as `irm .../install.ps1 | iex`: it must never call `exit`
# (that would close the user's shell), so failures are thrown instead.
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node is required for OpenUltraCode install."
}

if (-not $OpenCodeConfigDir) {
  $OpenCodeConfigDir = Join-Path $HOME ".config\opencode"
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $HOME ".local\share\open-ultracode"
}
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$InstallerLib = Join-Path $InstallDir "scripts\installer-lib.mjs"

$FusionAgents = @(
  @{ Name = "ultracode-fusion-panel-a.md"; Prompt = "Choose fusion panel A model" },
  @{ Name = "ultracode-fusion-panel-b.md"; Prompt = "Choose fusion panel B model" },
  @{ Name = "ultracode-fusion-arbiter.md"; Prompt = "Choose fusion arbiter model" }
)
# Files OpenUltraCode ships; tests/installer-assets.test.ts keeps these lists in sync with .opencode.
$ShippedCommands = @(
  "ultracode-debug.md",
  "ultracode-fusion-models.md",
  "ultracode-fusion.md",
  "ultracode-research.md",
  "ultracode-spec-audit.md",
  "ultracode-verify.md",
  "ultracode.md",
  "ultrathink-fusion.md",
  "ultrathink.md"
)
$ShippedAgents = @(
  "open-ultracode-adversary.md",
  "open-ultracode-implementer.md",
  "open-ultracode-planner.md",
  "open-ultracode-reconciler.md",
  "open-ultracode-researcher.md",
  "open-ultracode-verifier.md",
  "open-ultracode.md",
  "ultracode-fusion-arbiter.md",
  "ultracode-fusion-panel-a.md",
  "ultracode-fusion-panel-b.md"
)
$ModelIdPattern = '^[A-Za-z0-9][A-Za-z0-9._-]*/[^\s#]+(#max)?$'

# Native commands do not honor $ErrorActionPreference (and Windows PowerShell 5.1 turns
# their stderr into terminating errors when output is redirected), so every native call
# goes through this helper: stderr is passed through and a non-zero exit code throws.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Command)
  $ErrorActionPreference = "Continue"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Invoke-InstallerLib {
  param([Parameter(Mandatory)][string]$What, [Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  Invoke-Native $What { node $InstallerLib @Arguments }
}

function Get-AgentModel([string]$AgentFile) {
  $model = Invoke-InstallerLib "Reading $AgentFile" get-agent-model $AgentFile
  if ($model) { return [string]$model }
  return $null
}

function Assert-ModelId([string]$Model, [string]$Name) {
  if ($Model -notmatch $ModelIdPattern) { throw "$Name '$Model' must be provider/model or provider/model#max." }
}

# Your providers' models first, then opencode's hosted catalog; see list-models in
# scripts/installer-lib.mjs (it retries `opencode models` and adds models from your config).
function Get-OpenCodeModels {
  $ErrorActionPreference = "Continue"
  $output = node $InstallerLib list-models "--config-dir" $OpenCodeConfigDir 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) { return @() }
  return @($output | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match $ModelIdPattern })
}

function Test-InteractiveConsole {
  if ($NonInteractive -or $Host.Name -ne "ConsoleHost") { return $false }
  try {
    return -not ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected)
  } catch {
    return $false
  }
}

function Select-FusionModel([string]$Prompt, [string]$DefaultModel, [string]$CurrentModel, [string[]]$AvailableModels) {
  if ($CurrentModel) { $DefaultModel = $CurrentModel }
  if (-not (Test-InteractiveConsole)) {
    Write-Host "${Prompt}: using $DefaultModel"
    return $DefaultModel
  }
  $previousCtrlC = $null
  try {
    $previousCtrlC = [Console]::TreatControlCAsInput
    [Console]::TreatControlCAsInput = $true
    return Show-FusionModelMenu $Prompt $DefaultModel $AvailableModels
  } catch [System.IO.IOException] {
    Write-Host "${Prompt}: console menu unavailable, using $DefaultModel"
    return $DefaultModel
  } finally {
    if ($null -ne $previousCtrlC) { try { [Console]::TreatControlCAsInput = $previousCtrlC } catch { } }
  }
}

# Chooses all fusion models before anything is copied, so a cancelled or failed menu
# leaves the existing installation untouched.
function Resolve-FusionModels([string]$SourceAgentsDir, [string]$TargetAgentsDir, [hashtable]$Overrides) {
  $availableModels = @()
  if (Test-InteractiveConsole) { $availableModels = Get-OpenCodeModels }
  $chosen = @{}
  foreach ($agent in $FusionAgents) {
    $override = $Overrides[$agent.Name]
    if ($override) {
      Assert-ModelId $override $agent.Name
      $chosen[$agent.Name] = $override
      continue
    }
    $default = Get-AgentModel (Join-Path $SourceAgentsDir $agent.Name)
    if (-not $default) { throw "Shipped agent $($agent.Name) has no default model." }
    $current = Get-AgentModel (Join-Path $TargetAgentsDir $agent.Name)
    $model = Select-FusionModel $agent.Prompt $default $current $availableModels
    Assert-ModelId $model $agent.Name
    $chosen[$agent.Name] = $model
  }
  return $chosen
}

function Remove-LegacyGlobalFiles {
  # OpenCode 2 does not load ~/.config/opencode/tools; the plugin registers the fusion tool itself.
  Remove-Item -Path (Join-Path $OpenCodeConfigDir "tools\open_ultracode_configure_fusion.ts") -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $OpenCodeConfigDir "lib\fusion-config.ts") -Force -ErrorAction SilentlyContinue
}

function Install-GlobalAssets([string]$SourceDir, [hashtable]$Overrides) {
  $skillsDir = Join-Path $OpenCodeConfigDir "skills"
  $commandsDir = Join-Path $OpenCodeConfigDir "commands"
  $agentsDir = Join-Path $OpenCodeConfigDir "agents"
  $models = Resolve-FusionModels (Join-Path $SourceDir ".opencode\agents") $agentsDir $Overrides

  New-Item -ItemType Directory -Path $skillsDir, $commandsDir, $agentsDir -Force | Out-Null

  $targetSkill = Join-Path $skillsDir "open-ultracode"
  if (Test-Path $targetSkill) { Remove-Item -Path $targetSkill -Recurse -Force }
  Copy-Item -Path (Join-Path $SourceDir ".opencode\skills\open-ultracode") -Destination $targetSkill -Recurse -Force

  foreach ($name in $ShippedCommands) {
    Copy-Item -Path (Join-Path $SourceDir ".opencode\commands\$name") -Destination $commandsDir -Force
  }
  foreach ($name in $ShippedAgents) {
    Copy-Item -Path (Join-Path $SourceDir ".opencode\agents\$name") -Destination $agentsDir -Force
  }
  foreach ($agent in $FusionAgents) {
    Invoke-InstallerLib "Setting the $($agent.Name) model" set-agent-model (Join-Path $agentsDir $agent.Name) $models[$agent.Name]
  }
  Remove-LegacyGlobalFiles

  $pluginPath = Join-Path $SourceDir ".opencode\plugins\open-ultracode"
  Invoke-InstallerLib "Registering the OpenUltraCode plugin" register "--config-dir" $OpenCodeConfigDir "--plugin-path" $pluginPath
}

function Remove-GlobalAssets {
  $targetSkill = Join-Path $OpenCodeConfigDir "skills\open-ultracode"
  if (Test-Path $targetSkill) { Remove-Item -Path $targetSkill -Recurse -Force }
  # Remove only the files OpenUltraCode ships, never a user's own ultracode-* agents or commands.
  foreach ($name in $ShippedCommands) {
    Remove-Item -Path (Join-Path $OpenCodeConfigDir "commands\$name") -Force -ErrorAction SilentlyContinue
  }
  foreach ($name in $ShippedAgents) {
    Remove-Item -Path (Join-Path $OpenCodeConfigDir "agents\$name") -Force -ErrorAction SilentlyContinue
  }
  Remove-LegacyGlobalFiles
  Invoke-InstallerLib "Unregistering the OpenUltraCode plugin" unregister "--config-dir" $OpenCodeConfigDir
}

function Show-FusionModelMenu([string]$Prompt, [string]$DefaultModel, [string[]]$AvailableModels) {
  $choices = [System.Collections.Generic.List[string]]::new()
  $choices.Add($DefaultModel)
  foreach ($model in $AvailableModels) {
    if ($model -ne $DefaultModel -and -not $choices.Contains($model)) { $choices.Add($model) }
  }
  $choices.Add("Custom model ID")

  $n = $choices.Count
  $bufferWidth = [Console]::BufferWidth
  $bufferHeight = [Console]::BufferHeight
  $width = [int][Math]::Min([Console]::WindowWidth, $bufferWidth)
  if ($width -lt 40) { $width = [int][Math]::Min(80, $bufferWidth) }
  $maxLen = 0
  foreach ($c in $choices) { if ($c.Length -gt $maxLen) { $maxLen = $c.Length } }
  $colWidth = [int][Math]::Max(12, [Math]::Min(64, $maxLen + 4))
  $cols = [int][Math]::Max(1, [Math]::Floor($width / $colWidth))
  $rows = [int][Math]::Ceiling($n / $cols)
  $windowRows = [int][Math]::Min([Console]::WindowHeight, $bufferHeight)
  $visibleRows = [int][Math]::Min($rows, [Math]::Max(5, $windowRows - 6))
  $needed = 2 + $visibleRows
  $top = [Console]::CursorTop
  if ($top + $needed -ge $bufferHeight) {
    $scroll = $top + $needed - $bufferHeight + 1
    for ($i = 0; $i -lt $scroll; $i++) { [Console]::WriteLine() }
    $top = [Math]::Min([Console]::CursorTop, $bufferHeight - $needed)
  }
  if ($top -lt 0) { $top = 0 }
  $bottomLine = [Math]::Min($top + 2 + $visibleRows, $bufferHeight - 1)
  $index = 0
  $offset = 0
  $origFg = [Console]::ForegroundColor
  $origBg = [Console]::BackgroundColor

  [Console]::SetCursorPosition(0, $top)
  [Console]::Write($Prompt.PadRight($width))
  while ($true) {
    for ($r = 0; $r -lt $visibleRows; $r++) {
      $y = [Math]::Min($top + 1 + $r, $bufferHeight - 1)
      [Console]::SetCursorPosition(0, $y)
      $x = 0
      for ($c = 0; $c -lt $cols; $c++) {
        $i = $c * $rows + $offset + $r
        if ($i -ge $n) { break }
        $text = $choices[$i]
        if ($text.Length -gt $colWidth - 4) { $text = $text.Substring(0, $colWidth - 7) + "..." }
        $cell = $text.PadRight($colWidth - 2)
        if ($i -eq $index) {
          [Console]::ForegroundColor = [ConsoleColor]::Black
          [Console]::BackgroundColor = [ConsoleColor]::Cyan
          [Console]::Write($cell)
          [Console]::ForegroundColor = $origFg
          [Console]::BackgroundColor = $origBg
        } else {
          [Console]::Write($cell)
        }
        $x += $cell.Length
      }
      $rest = [Math]::Max(0, $width - $x)
      if ($rest -gt 0) { [Console]::Write(" " * $rest) }
    }
    $above = $offset
    $below = $rows - $offset - $visibleRows
    $hint = "  "
    if ($above -gt 0) { $hint += "^ $above more above   " }
    if ($below -gt 0) { $hint += "v $below more below" }
    $hy = [Math]::Min($top + 1 + $visibleRows, $bufferHeight - 1)
    [Console]::SetCursorPosition(0, $hy)
    [Console]::Write($hint.PadRight($width))
    [Console]::SetCursorPosition(0, $bottomLine)

    $key = [Console]::ReadKey($true)
    if ($key.Key -eq [ConsoleKey]::C -and ($key.Modifiers -band [ConsoleModifiers]::Control)) {
      [Console]::SetCursorPosition(0, $bottomLine)
      throw "OpenUltraCode installation cancelled."
    }
    switch ($key.Key) {
      UpArrow { $index = ($index - 1 + $n) % $n }
      DownArrow { $index = ($index + 1) % $n }
      LeftArrow { $index = (($index - $rows) % $n + $n) % $n }
      RightArrow { $index = ($index + $rows) % $n }
      Enter {
        [Console]::SetCursorPosition(0, $bottomLine)
        $picked = $choices[$index]
        if ($picked -eq "Custom model ID") {
          $custom = Read-Host "Enter provider/model or provider/model#max"
          if ($custom -match $ModelIdPattern) { return $custom }
          Write-Host "Invalid model ID: $custom"
          continue
        }
        return $picked
      }
      default { }
    }
    $row = $index % $rows
    if ($row -lt $offset) { $offset = $row }
    if ($row -ge $offset + $visibleRows) { $offset = $row - $visibleRows + 1 }
  }
}

# Makes the running opencode pick up the install (`opencode reload`), then checks the REAL
# installation: the coordinator and every fusion agent must name a provider, model, and variant
# that opencode offers; with -Live each fusion agent must also answer through a real dispatch.
function Invoke-RuntimeCheck([string]$SourceDir, [bool]$Live) {
  if ($SkipRuntimeCheck) {
    Write-Host "OpenUltraCode: runtime check skipped (-SkipRuntimeCheck)."
    return
  }
  if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    Write-Warning "opencode is not on PATH; skipped the runtime check."
    return
  }
  $ErrorActionPreference = "Continue"
  opencode reload *> $null
  if ($LASTEXITCODE -ne 0) { Write-Warning "'opencode reload' failed; restart opencode to load the changes." }
  $checkArgs = @((Join-Path $SourceDir "scripts\runtime-check.mjs"), "--config-dir", $OpenCodeConfigDir)
  if ($Live) { $checkArgs += "--live" }
  node @checkArgs
  $checkStatus = $LASTEXITCODE
  if ($checkStatus -eq 1) { throw "The runtime check found problems (see above). Fix them with -PanelA/-PanelB/-Decider or /ultracode-fusion-models." }
  if ($checkStatus -ne 0) { Write-Warning "The runtime check could not reach opencode; run 'node $($checkArgs[0])' after starting it." }
}

function Test-OpenUltraCodeInstallDir([string]$Path) {
  return (Test-Path (Join-Path $Path ".opencode\plugins\open-ultracode")) -and (Test-Path (Join-Path $Path "scripts\installer-lib.mjs"))
}

function Get-TarCommand {
  # Prefer the Windows bsdtar: GNU tar from Git's usr\bin cannot handle "C:" paths.
  if ($env:SystemRoot) {
    $windowsTar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (Test-Path $windowsTar) { return $windowsTar }
  }
  if (Get-Command tar -ErrorAction SilentlyContinue) { return "tar" }
  throw "tar is required to extract the release archive."
}

function Install-LatestRelease {
  if ((Test-Path $InstallDir) -and (Get-ChildItem -Path $InstallDir -Force | Select-Object -First 1) -and -not (Test-Path (Join-Path $InstallDir ".opencode\plugins\open-ultracode"))) {
    throw "Refusing to replace $InstallDir because it is not an OpenUltraCode installation. Choose another -InstallDir."
  }

  $id = [System.Guid]::NewGuid().ToString("N")
  $parent = Split-Path -Parent $InstallDir
  $stage = "$InstallDir.new-$id"
  $previous = "$InstallDir.old-$id"
  $downloadPath = Join-Path ([System.IO.Path]::GetTempPath()) "open-ultracode-$id.tar.gz"
  $releaseUrl = "https://github.com/$Repo/releases/latest/download/open-ultracode-release.tar.gz"

  try {
    if ($Archive) {
      Copy-Item -Path $Archive -Destination $downloadPath
    } else {
      Write-Host "Downloading latest OpenUltraCode release from $releaseUrl..."
      $ProgressPreference = "SilentlyContinue"
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      try {
        Invoke-WebRequest -Uri $releaseUrl -OutFile $downloadPath -UseBasicParsing
      } catch {
        throw "Could not download the latest OpenUltraCode release asset from ${releaseUrl}: $_"
      }
    }

    New-Item -ItemType Directory -Path $parent, $stage -Force | Out-Null
    $tar = Get-TarCommand
    Invoke-Native "Extracting the release archive" { & $tar -xzf $downloadPath -C $stage }
    if (-not (Test-OpenUltraCodeInstallDir $stage)) {
      throw "The downloaded release archive is incomplete; the existing installation was left unchanged."
    }

    if (Test-Path $InstallDir) { Move-Item -Path $InstallDir -Destination $previous }
    Move-Item -Path $stage -Destination $InstallDir
  } finally {
    Remove-Item -Path $downloadPath -Force -ErrorAction SilentlyContinue
    if (Test-Path $stage) { Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue }
    if ((Test-Path $previous) -and (Test-Path $InstallDir)) { Remove-Item -Path $previous -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

if ($Remove) {
  if (-not (Test-Path $InstallerLib)) {
    throw "$InstallDir does not contain an OpenUltraCode installation. Pass -InstallDir, or reinstall and then run -Remove."
  }
  Remove-GlobalAssets
  if (Test-OpenUltraCodeInstallDir $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
  }
  Write-Host "OpenUltraCode has been removed from opencode. Restart opencode to unload the plugin, commands, skills, and agents."
  return
}

$overrides = @{
  "ultracode-fusion-panel-a.md" = $PanelA
  "ultracode-fusion-panel-b.md" = $PanelB
  "ultracode-fusion-arbiter.md" = $Decider
}
foreach ($entry in $overrides.GetEnumerator()) {
  if ($entry.Value) { Assert-ModelId $entry.Value $entry.Key }
}

Install-LatestRelease
Install-GlobalAssets $InstallDir $overrides
Invoke-RuntimeCheck $InstallDir $Verify.IsPresent

# Show what is actually installed, read back from disk.
Write-Host ""
Invoke-InstallerLib "Summarizing the installation" summary "--config-dir" $OpenCodeConfigDir "--source-dir" $InstallDir | ForEach-Object { Write-Host $_ }
