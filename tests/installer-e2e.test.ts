import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildReleaseArchive } from "../scripts/build-release-archive.mjs"

// Runs the real installers against temporary config and install directories. They never
// touch the user's ~/.config/opencode: every run passes explicit directories.

const repoRoot = process.cwd()
const timeout = 120_000

function hasCommand(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 })
  return result.error === undefined && result.status === 0
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `open-ultracode-${prefix}-`))
}

function readConfig(configDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8")) as Record<string, unknown>
}

function ourPluginPaths(config: Record<string, unknown>): string[] {
  return [config.plugins, config.plugin]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((entry) => (typeof entry === "string" ? entry : String((entry as { package?: unknown }).package)))
    .filter((value) => value.replace(/\\/g, "/").includes("/.opencode/plugins/open-ultracode"))
}

function assertOk(result: SpawnSyncReturns<string>, what: string): void {
  assert.equal(result.error, undefined, `${what}: ${String(result.error)}`)
  assert.equal(result.status, 0, `${what} failed:\n${result.stdout}\n${result.stderr}`)
}

/** A user config with comments, a trailing comma, a BOM, foreign entries, and a stale V1 path. */
function seedConfigDir(): string {
  const configDir = tempDir("config")
  writeFileSync(
    join(configDir, "opencode.json"),
    "\uFEFF{\n  // personal settings\n  \"model\": \"anthropic/claude-sonnet\",\n" +
      "  \"plugin\": [\"opencode-wakatime\", \"C:/old/open-ultracode/0.1.3/.opencode/plugins/open-ultracode.ts\"],\n" +
      "  \"permission\": { \"bash\": { \"rm -rf *\": \"deny\" } },\n}\n"
  )
  mkdirSync(join(configDir, "agents"))
  writeFileSync(join(configDir, "agents", "ultracode-fusion-custom.md"), "---\nmodel: me/mine\n---\nmy own panel\n")
  return configDir
}

function assertForeignSettingsKept(configDir: string): void {
  const config = readConfig(configDir)
  assert.equal(config.model, "anthropic/claude-sonnet")
  assert.deepEqual(config.plugin, ["opencode-wakatime"])
  assert.deepEqual(config.permission, { bash: { "rm -rf *": "deny" } })
  assert.ok(existsSync(join(configDir, "agents", "ultracode-fusion-custom.md")), "a user's own agent must survive")
}

function agentModel(configDir: string, agent: string): string | undefined {
  return /^model: (\S+)/mu.exec(readFileSync(join(configDir, "agents", agent), "utf8"))?.[1]
}

let archive = ""
function releaseArchive(): string {
  if (archive === "") {
    archive = buildReleaseArchive(join(tempDir("archive"), "open-ultracode-release.tar.gz"))
  }
  return archive
}

const powershells = [
  ...(hasCommand("pwsh", ["-NoProfile", "-Command", "exit 0"]) ? ["pwsh"] : []),
  ...(process.platform === "win32" && hasCommand("powershell.exe", ["-NoProfile", "-Command", "exit 0"]) ? ["powershell.exe"] : [])
]
const hasSh = hasCommand("sh", ["-c", "exit 0"])

for (const shell of powershells) {
  describe(`PowerShell installers (${shell})`, () => {
    const run = (script: string, ...args: string[]) =>
      spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repoRoot, script), ...args], {
        cwd: tempDir("cwd"),
        encoding: "utf8",
        timeout
      })

    it("installs from the checkout, stays idempotent, and removes only its own files", () => {
      const configDir = seedConfigDir()

      assertOk(run("install-dev.ps1", "-SkipChecks", "-NonInteractive", "-OpenCodeConfigDir", configDir), "install-dev.ps1")
      assertOk(run("install-dev.ps1", "-SkipChecks", "-NonInteractive", "-OpenCodeConfigDir", configDir), "second install-dev.ps1")

      assert.equal(ourPluginPaths(readConfig(configDir)).length, 1)
      assertForeignSettingsKept(configDir)
      assert.equal(agentModel(configDir, "ultracode-fusion-panel-a.md"), "mistral/mistral-large-4")
      assert.ok(!existsSync(join(configDir, "tools", "open_ultracode_configure_fusion.ts")))

      assertOk(run("install-dev.ps1", "-Remove", "-OpenCodeConfigDir", configDir), "install-dev.ps1 -Remove")
      assert.deepEqual(ourPluginPaths(readConfig(configDir)), [])
      assertForeignSettingsKept(configDir)
      assert.deepEqual(readdirSync(join(configDir, "agents")), ["ultracode-fusion-custom.md"])
    })

    it("sets every fusion model from batch flags in the dev installer and rejects a bad one before any change", () => {
      const configDir = seedConfigDir()

      assertOk(
        run("install-dev.ps1", "-SkipChecks", "-NonInteractive", "-OpenCodeConfigDir", configDir, "-PanelA", "vibe-oidc/mistral-large-4", "-PanelB", "vibe-oidc/zai-glm-5-3#max", "-Decider", "openai/gpt-x"),
        "install-dev.ps1 with model flags"
      )
      assert.deepEqual(
        ["ultracode-fusion-panel-a.md", "ultracode-fusion-panel-b.md", "ultracode-fusion-arbiter.md"].map((agent) => agentModel(configDir, agent)),
        ["vibe-oidc/mistral-large-4", "vibe-oidc/zai-glm-5-3", "openai/gpt-x"]
      )

      const before = readFileSync(join(configDir, "opencode.json"), "utf8")
      // Without -SkipChecks: an invalid model must fail before pnpm install/check run.
      const bad = run("install-dev.ps1", "-NonInteractive", "-OpenCodeConfigDir", configDir, "-Decider", "not a model")
      assert.notEqual(bad.status, 0)
      assert.match(`${bad.stdout}${bad.stderr}`, /must be provider\/model/u)
      assert.doesNotMatch(bad.stdout, /pnpm/u)
      assert.equal(readFileSync(join(configDir, "opencode.json"), "utf8"), before)
    })

    it("installs a release archive over a dev install and rejects bad input without changes", () => {
      const configDir = seedConfigDir()
      const installDir = join(tempDir("home"), "open-ultracode")
      assertOk(run("install-dev.ps1", "-SkipChecks", "-NonInteractive", "-OpenCodeConfigDir", configDir), "install-dev.ps1")

      assertOk(
        run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-NonInteractive", "-PanelB", "openai/gpt-x", "-OpenCodeConfigDir", configDir),
        "install.ps1"
      )
      const paths = ourPluginPaths(readConfig(configDir))
      assert.equal(paths.length, 1)
      // Compare real paths: CI temp directories use 8.3 short names (RUNNER~1) on Windows.
      const normalize = (value: string) => realpathSync.native(value).replace(/\\/g, "/").toLowerCase()
      const [registered = ""] = paths
      assert.ok(normalize(registered).startsWith(normalize(installDir)), registered)
      assert.equal(agentModel(configDir, "ultracode-fusion-panel-b.md"), "openai/gpt-x")
      const configAfterInstall = readFileSync(join(configDir, "opencode.json"), "utf8")

      const badModel = run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-NonInteractive", "-PanelA", "not a model", "-OpenCodeConfigDir", configDir)
      const garbage = join(tempDir("garbage"), "release.tar.gz")
      writeFileSync(garbage, "not an archive")
      const badArchive = run("install.ps1", "-Archive", garbage, "-InstallDir", installDir, "-NonInteractive", "-OpenCodeConfigDir", configDir)

      assert.notEqual(badModel.status, 0, "an invalid model must fail the install")
      assert.notEqual(badArchive.status, 0, "a broken archive must fail the install")
      assert.equal(readFileSync(join(configDir, "opencode.json"), "utf8"), configAfterInstall)
      assert.ok(existsSync(join(installDir, "scripts", "installer-lib.mjs")), "a failed update must keep the previous installation")

      assertOk(run("install.ps1", "-Remove", "-InstallDir", installDir, "-OpenCodeConfigDir", configDir), "install.ps1 -Remove")
      assert.deepEqual(ourPluginPaths(readConfig(configDir)), [])
      assert.ok(!existsSync(installDir))
      assertForeignSettingsKept(configDir)
    })
  })
}

// Git for Windows' sh is slow and its fork() is unreliable under memory pressure, so the
// sh installers are exercised on Linux/macOS (CI) and on Windows only on request.
const runShTests = hasSh && (process.platform !== "win32" || process.env.OPENULTRACODE_E2E_SH === "1")

describe("sh installers", { skip: !runShTests && "set OPENULTRACODE_E2E_SH=1 to run the sh installers on Windows" }, () => {
  let home = ""
  before(() => {
    home = tempDir("home")
  })
  const run = (script: string, configDir: string, installDir: string, ...args: string[]) =>
    spawnSync("sh", [join(repoRoot, script), ...args], {
      cwd: tempDir("cwd"),
      encoding: "utf8",
      timeout,
      input: "",
      env: { ...process.env, HOME: home, OPENCODE_CONFIG_DIR: configDir, OPENULTRACODE_HOME: installDir }
    })

  it("installs, switches between dev and release installs, and removes cleanly", () => {
    const configDir = seedConfigDir()
    const installDir = join(home, "open-ultracode")

    assertOk(run("install-dev.sh", configDir, installDir, "--skip-checks", "--non-interactive", "--panel-b", "vibe-oidc/zai-glm-5-3"), "install-dev.sh")
    assert.equal(agentModel(configDir, "ultracode-fusion-panel-b.md"), "vibe-oidc/zai-glm-5-3")
    assertOk(run("install.sh", configDir, installDir, "--non-interactive", "--archive", releaseArchive(), "--decider", "openai/gpt-x"), "install.sh")
    assertOk(run("install.sh", configDir, installDir, "--non-interactive", "--archive", releaseArchive()), "second install.sh")

    assert.equal(ourPluginPaths(readConfig(configDir)).length, 1)
    assert.equal(agentModel(configDir, "ultracode-fusion-arbiter.md"), "openai/gpt-x", "a chosen model must be kept on update")
    assertForeignSettingsKept(configDir)

    const before = readFileSync(join(configDir, "opencode.json"), "utf8")
    const badModel = run("install.sh", configDir, installDir, "--non-interactive", "--archive", releaseArchive(), "--panel-a", "not a model")
    assert.notEqual(badModel.status, 0)
    assert.equal(readFileSync(join(configDir, "opencode.json"), "utf8"), before)

    assertOk(run("install.sh", configDir, installDir, "--remove"), "install.sh --remove")
    assert.deepEqual(ourPluginPaths(readConfig(configDir)), [])
    assert.ok(!existsSync(installDir))
    assertForeignSettingsKept(configDir)
  })

  it("refuses to replace a directory that is not an OpenUltraCode installation", () => {
    const configDir = seedConfigDir()
    const installDir = tempDir("not-ours")
    writeFileSync(join(installDir, "precious.txt"), "keep me")

    const result = run("install.sh", configDir, installDir, "--non-interactive", "--archive", releaseArchive())

    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(join(installDir, "precious.txt"), "utf8"), "keep me")
  })
})
