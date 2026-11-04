import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildReleaseArchive } from "../scripts/build-release-archive.mjs"
import { modelList, models, ref, shippedFusionDefaults } from "./fixtures/models.js"

const shipped = shippedFusionDefaults()
const shippedProvider = shipped.panelA.split("/")[0] ?? ""
const userModel = ref(models.otherFamilyWithMax)

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
    `\uFEFF{\n  // personal settings\n  "model": "${userModel}",\n` +
      "  \"plugin\": [\"opencode-wakatime\", \"C:/old/open-ultracode/0.1.3/.opencode/plugins/open-ultracode.ts\"],\n" +
      "  \"permission\": { \"bash\": { \"rm -rf *\": \"deny\" } },\n}\n"
  )
  mkdirSync(join(configDir, "agents"))
  writeFileSync(join(configDir, "agents", "ultracode-fusion-custom.md"), "---\nmodel: me/mine\n---\nmy own panel\n")
  return configDir
}

function assertForeignSettingsKept(configDir: string): void {
  const config = readConfig(configDir)
  assert.equal(config.model, userModel)
  assert.deepEqual(config.plugin, ["opencode-wakatime"])
  assert.deepEqual(config.permission, { bash: { "rm -rf *": "deny" } })
  assert.ok(existsSync(join(configDir, "agents", "ultracode-fusion-custom.md")), "a user's own agent must survive")
}

function agentModel(configDir: string, agent: string): string | undefined {
  return /^model: (\S+)/mu.exec(readFileSync(join(configDir, "agents", agent), "utf8"))?.[1]
}

/**
 * A fake `opencode` on PATH that answers `reload` and `api model.list` with the model list
 * of tests/fixtures/models.ts (synthetic providers). Installer runs then exercise the
 * real reload + runtime check path deterministically, without touching a developer's opencode.
 */
function fakeOpencodePath(): string {
  const bin = tempDir("fake-opencode")
  writeFileSync(join(bin, "fake-opencode.mjs"), [
    "const args = process.argv.slice(2).join(' ')",
    "if (args === 'reload') { console.log('Configuration reloaded'); process.exit(0) }",
    `if (args === 'api model.list') { console.log(JSON.stringify({ data: ${JSON.stringify(modelList)} })); process.exit(0) }`,
    "console.error('fake opencode: unsupported ' + args); process.exit(1)"
  ].join("\n"))
  writeFileSync(join(bin, "opencode.cmd"), `@"${process.execPath}" "%~dp0fake-opencode.mjs" %*\r\n`)
  writeFileSync(join(bin, "opencode"), `#!/bin/sh\nexec "${process.execPath.replace(/\\\\/g, "/")}" "$(dirname "$0")/fake-opencode.mjs" "$@"\n`)
  chmodSync(join(bin, "opencode"), 0o755)
  return bin
}

function withFakeOpencode(): NodeJS.ProcessEnv {
  // Windows environment names are case-insensitive: a copied environment may hold "Path"
  // (and under Git's sh also "PATH"); every variant must point at the fake first.
  // A git hook's environment holds both, with different entries, so all of them are merged.
  const env: NodeJS.ProcessEnv = {}
  const entries: string[] = [fakeOpencodePath()]
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() !== "PATH") env[key] = value
    else for (const entry of (value ?? "").split(delimiter)) if (entry !== "" && !entries.includes(entry)) entries.push(entry)
  }
  env.PATH = entries.join(delimiter)
  return env
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

for (const shell of powershells.slice(0, 1)) {
  describe(`PowerShell installers with the runtime check (${shell}, fake opencode)`, () => {
    const run = (script: string, ...args: string[]) =>
      spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repoRoot, script), ...args], {
        cwd: tempDir("cwd"),
        encoding: "utf8",
        timeout,
        env: withFakeOpencode()
      })

    it("fails a release install whose fusion models the running opencode cannot serve, and passes with valid ones", () => {
      // A fresh config without a coordinator model: opencode then uses its default, which is valid.
      const configDir = tempDir("config")
      writeFileSync(join(configDir, "opencode.json"), "{}\n")
      const installDir = join(tempDir("home"), "open-ultracode")

      const defaults = run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-NonInteractive", "-OpenCodeConfigDir", configDir)
      // The fake opencode offers only synthetic providers, so the shipped defaults' provider is unavailable.
      assert.notEqual(defaults.status, 0, `fusion defaults the running opencode cannot serve must fail the install:\n${defaults.stdout}\n${defaults.stderr}`)
      assert.ok(`${defaults.stdout}${defaults.stderr}`.includes(`FAIL ultracode-fusion-panel-a: provider ${shippedProvider} is not available`), defaults.stdout)
      assert.doesNotMatch(`${defaults.stdout}${defaults.stderr}`, /coordinator: no model configured/u)

      const valid = run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-NonInteractive", "-OpenCodeConfigDir", configDir,
        "-PanelA", ref(models.noVariants), "-PanelB", ref(models.otherFamilyWithMax, "max"), "-Decider", ref(models.withMax, "max"))
      assertOk(valid, "install.ps1 with models the running opencode offers")
      assert.match(valid.stdout, /result: OK/u)

      const badVariant = run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-NonInteractive", "-OpenCodeConfigDir", configDir,
        "-PanelA", ref(models.noVariants, "max"))
      assert.notEqual(badVariant.status, 0)
      assert.match(`${badVariant.stdout}${badVariant.stderr}`, /selects variant "max", but opencode reports no variants/u)
    })
  })
}

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

      assertOk(run("install-dev.ps1", "-SkipChecks", "-SkipRuntimeCheck", "-NonInteractive", "-OpenCodeConfigDir", configDir), "install-dev.ps1")
      assertOk(run("install-dev.ps1", "-SkipChecks", "-SkipRuntimeCheck", "-NonInteractive", "-OpenCodeConfigDir", configDir), "second install-dev.ps1")

      assert.equal(ourPluginPaths(readConfig(configDir)).length, 1)
      assertForeignSettingsKept(configDir)
      assert.equal(agentModel(configDir, "ultracode-fusion-panel-a.md"), shipped.panelA.replace(/#max$/u, ""))
      assert.ok(!existsSync(join(configDir, "tools", "open_ultracode_configure_fusion.ts")))

      assertOk(run("install-dev.ps1", "-Remove", "-OpenCodeConfigDir", configDir), "install-dev.ps1 -Remove")
      assert.deepEqual(ourPluginPaths(readConfig(configDir)), [])
      assertForeignSettingsKept(configDir)
      assert.deepEqual(readdirSync(join(configDir, "agents")), ["ultracode-fusion-custom.md"])
    })

    it("sets every fusion model from batch flags in the dev installer and rejects a bad one before any change", () => {
      const configDir = seedConfigDir()

      assertOk(
        run("install-dev.ps1", "-SkipChecks", "-SkipRuntimeCheck", "-NonInteractive", "-OpenCodeConfigDir", configDir, "-PanelA", ref(models.withMax), "-PanelB", ref(models.otherFamilyWithMax, "max"), "-Decider", ref(models.small)),
        "install-dev.ps1 with model flags"
      )
      assert.deepEqual(
        ["ultracode-fusion-panel-a.md", "ultracode-fusion-panel-b.md", "ultracode-fusion-arbiter.md"].map((agent) => agentModel(configDir, agent)),
        [ref(models.withMax), ref(models.otherFamilyWithMax), ref(models.small)]
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
      assertOk(run("install-dev.ps1", "-SkipChecks", "-SkipRuntimeCheck", "-NonInteractive", "-OpenCodeConfigDir", configDir), "install-dev.ps1")

      assertOk(
        run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-SkipRuntimeCheck", "-NonInteractive", "-PanelB", ref(models.small), "-OpenCodeConfigDir", configDir),
        "install.ps1"
      )
      const paths = ourPluginPaths(readConfig(configDir))
      assert.equal(paths.length, 1)
      // Compare real paths: CI temp directories use 8.3 short names (RUNNER~1) on Windows.
      const normalize = (value: string) => realpathSync.native(value).replace(/\\/g, "/").toLowerCase()
      const [registered = ""] = paths
      assert.ok(normalize(registered).startsWith(normalize(installDir)), registered)
      assert.equal(agentModel(configDir, "ultracode-fusion-panel-b.md"), ref(models.small))
      const configAfterInstall = readFileSync(join(configDir, "opencode.json"), "utf8")

      const badModel = run("install.ps1", "-Archive", releaseArchive(), "-InstallDir", installDir, "-SkipRuntimeCheck", "-NonInteractive", "-PanelA", "not a model", "-OpenCodeConfigDir", configDir)
      const garbage = join(tempDir("garbage"), "release.tar.gz")
      writeFileSync(garbage, "not an archive")
      const badArchive = run("install.ps1", "-Archive", garbage, "-InstallDir", installDir, "-SkipRuntimeCheck", "-NonInteractive", "-OpenCodeConfigDir", configDir)

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
  it("runs the runtime check against opencode's model list after installing (fake opencode)", () => {
    const configDir = tempDir("config")
    writeFileSync(join(configDir, "opencode.json"), "{}\n")
    const shHome = tempDir("home")
    const installDir = join(shHome, "open-ultracode")
    const env = { ...withFakeOpencode(), HOME: shHome, OPENCODE_CONFIG_DIR: configDir, OPENULTRACODE_HOME: installDir }
    const runSh = (...args: string[]) => spawnSync("sh", [join(repoRoot, "install.sh"), ...args], { cwd: tempDir("cwd"), encoding: "utf8", timeout, input: "", env })

    const defaults = runSh("--non-interactive", "--archive", releaseArchive())
    assert.notEqual(defaults.status, 0)
    assert.ok(`${defaults.stdout}${defaults.stderr}`.includes(`provider ${shippedProvider} is not available`), defaults.stdout)

    const valid = runSh("--non-interactive", "--archive", releaseArchive(), "--panel-a", ref(models.noVariants), "--panel-b", ref(models.otherFamilyWithMax, "max"), "--decider", ref(models.withMax, "max"))
    assertOk(valid, "install.sh with models the running opencode offers")
    assert.match(valid.stdout, /result: OK/u)
  })

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

    assertOk(run("install-dev.sh", configDir, installDir, "--skip-checks", "--skip-runtime-check", "--non-interactive", "--panel-b", ref(models.otherFamilyWithMax)), "install-dev.sh")
    assert.equal(agentModel(configDir, "ultracode-fusion-panel-b.md"), ref(models.otherFamilyWithMax))
    assertOk(run("install.sh", configDir, installDir, "--skip-runtime-check", "--non-interactive", "--archive", releaseArchive(), "--decider", ref(models.small)), "install.sh")
    assertOk(run("install.sh", configDir, installDir, "--skip-runtime-check", "--non-interactive", "--archive", releaseArchive()), "second install.sh")

    assert.equal(ourPluginPaths(readConfig(configDir)).length, 1)
    assert.equal(agentModel(configDir, "ultracode-fusion-arbiter.md"), ref(models.small), "a chosen model must be kept on update")
    assertForeignSettingsKept(configDir)

    const before = readFileSync(join(configDir, "opencode.json"), "utf8")
    const badModel = run("install.sh", configDir, installDir, "--skip-runtime-check", "--non-interactive", "--archive", releaseArchive(), "--panel-a", "not a model")
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

    const result = run("install.sh", configDir, installDir, "--skip-runtime-check", "--non-interactive", "--archive", releaseArchive())

    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(join(installDir, "precious.txt"), "utf8"), "keep me")
  })
})
