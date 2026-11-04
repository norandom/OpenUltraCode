import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  catalogProviders,
  configuredModels,
  getAgentModel,
  installSummary,
  listModels,
  orderModels,
  parseModelList,
  normalizePluginPath,
  parseJsonc,
  registerPlugin,
  setAgentModel,
  unregisterPlugin
} from "../scripts/installer-lib.mjs"
import { models, providers, ref } from "./fixtures/models.js"

// opencode's own hosted catalog providers come from the code under test, never from a literal.
const [catalogA = "", catalogB = ""] = [...catalogProviders]

const libPath = join(process.cwd(), "scripts", "installer-lib.mjs")
const devPlugin = join(tmpdir(), "checkout", ".opencode", "plugins", "open-ultracode")
const releasePlugin = join(tmpdir(), "release", ".opencode", "plugins", "open-ultracode")

function configDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "open-ultracode-config-"))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

function readJson(dir: string, name = "opencode.json"): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>
}

function ourPlugins(config: Record<string, unknown>): unknown[] {
  return [...asArray(config.plugins), ...asArray(config.plugin)].filter((entry) =>
    JSON.stringify(entry).replace(/\\\\/g, "/").includes("/.opencode/plugins/open-ultracode")
  )
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function backups(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".backup-openultracode-"))
}

const foreignConfig = {
  $schema: "https://opencode.ai/config.json",
  model: ref(models.otherFamilyWithMax),
  plugin: ["opencode-wakatime", "C:/old/open-ultracode/0.1.3/.opencode/plugins/open-ultracode.ts"],
  plugins: ["@tarquinen/opencode-dcp@latest", { package: "C:\\Users\\me\\old\\.opencode\\plugins\\open-ultracode" }],
  permission: { bash: { "rm -rf *": "deny" }, edit: "ask", open_ultracode_configure_fusion: "ask" },
  permissions: [{ action: "bash", resource: "git push*", effect: "ask" }]
}

describe("installer config editing", () => {
  it("creates a valid opencode.json with one plugin entry and the fusion ask rule", () => {
    const dir = configDir()

    const registered = registerPlugin({ configDir: dir, pluginPath: devPlugin })

    const config = readJson(dir)
    assert.equal(config.$schema, "https://opencode.ai/config.json")
    assert.deepEqual(config.plugins, [{ package: registered }])
    assert.deepEqual(config.permissions, [{ action: "open_ultracode_configure_fusion", resource: "*", effect: "ask" }])
    assert.deepEqual(backups(dir), [])
  })

  it("keeps every foreign plugin, permission, and setting", () => {
    const dir = configDir({ "opencode.json": JSON.stringify(foreignConfig) })

    registerPlugin({ configDir: dir, pluginPath: devPlugin })

    const config = readJson(dir)
    assert.equal(config.model, ref(models.otherFamilyWithMax))
    assert.deepEqual(config.plugin, ["opencode-wakatime"])
    assert.deepEqual(asArray(config.plugins).slice(0, 1), ["@tarquinen/opencode-dcp@latest"])
    assert.deepEqual(config.permission, { bash: { "rm -rf *": "deny" }, edit: "ask" })
    assert.deepEqual(asArray(config.permissions)[0], { action: "bash", resource: "git push*", effect: "ask" })
    assert.equal(ourPlugins(config).length, 1)
    assert.equal(backups(dir).length, 1)
  })

  it("is idempotent and replaces entries from other install locations", () => {
    const dir = configDir()

    registerPlugin({ configDir: dir, pluginPath: devPlugin })
    const released = registerPlugin({ configDir: dir, pluginPath: releasePlugin })
    const once = readFileSync(join(dir, "opencode.json"), "utf8")
    const backupCount = backups(dir).length
    registerPlugin({ configDir: dir, pluginPath: releasePlugin })

    assert.deepEqual(readJson(dir).plugins, [{ package: released }])
    assert.equal(readFileSync(join(dir, "opencode.json"), "utf8"), once)
    assert.equal(backups(dir).length, backupCount, "an unchanged config must not create another backup")
  })

  it("reads JSONC with comments, trailing commas, and a BOM", () => {
    const text = "\uFEFF{\n  // comment with \"quotes\" and , ]\n  \"url\": \"http://a//b,]\",\n  /* block */ \"plugin\": [\"x\",],\n}\n"

    assert.deepEqual(parseJsonc(text), { url: "http://a//b,]", plugin: ["x"] })
  })

  it("prunes stale OpenUltraCode entries from opencode.jsonc and leaves the rest", () => {
    const jsonc = `{
  // user comment
  "plugin": ["C:/Users/me/.local/share/open-ultracode/0.1.3/.opencode/plugins/open-ultracode.ts"],
  "plugins": [{ "package": "C:\\\\plugins\\\\packages\\\\some-other-plugin", "options": { "a": 1 } },],
  "model": "${ref(models.withMax)}",
}
`
    const dir = configDir({ "opencode.jsonc": jsonc })

    registerPlugin({ configDir: dir, pluginPath: devPlugin })

    const pruned = readJson(dir, "opencode.jsonc")
    assert.equal(pruned.plugin, undefined)
    assert.deepEqual(pruned.plugins, [{ package: "C:\\plugins\\packages\\some-other-plugin", options: { a: 1 } }])
    assert.equal(pruned.model, ref(models.withMax))
    assert.equal(ourPlugins(readJson(dir)).length, 1)
    assert.equal(backups(dir).length, 1)
  })

  it("refuses to touch anything when a config file cannot be parsed", () => {
    const broken = "{ \"plugins\": [ }"
    const dir = configDir({ "opencode.json": JSON.stringify(foreignConfig), "opencode.jsonc": broken })
    const before = readFileSync(join(dir, "opencode.json"), "utf8")

    assert.throws(() => registerPlugin({ configDir: dir, pluginPath: devPlugin }), /Could not parse/u)
    assert.equal(readFileSync(join(dir, "opencode.json"), "utf8"), before)
    assert.equal(readFileSync(join(dir, "opencode.jsonc"), "utf8"), broken)
  })

  it("removes only OpenUltraCode entries on unregister", () => {
    const dir = configDir({ "opencode.json": JSON.stringify(foreignConfig) })

    registerPlugin({ configDir: dir, pluginPath: devPlugin })
    unregisterPlugin({ configDir: dir })

    const config = readJson(dir)
    assert.equal(ourPlugins(config).length, 0)
    assert.deepEqual(config.plugin, ["opencode-wakatime"])
    assert.deepEqual(config.plugins, ["@tarquinen/opencode-dcp@latest"])
    assert.deepEqual(config.permission, { bash: { "rm -rf *": "deny" }, edit: "ask" })
    assert.deepEqual(config.permissions, [{ action: "bash", resource: "git push*", effect: "ask" }])
  })

  it("converts MSYS paths for native Windows opencode", () => {
    assert.equal(normalizePluginPath("/c/Users/me/x/.opencode/plugins/open-ultracode", "win32"), "C:/Users/me/x/.opencode/plugins/open-ultracode")
    assert.equal(normalizePluginPath("D:\\src\\.opencode\\plugins\\open-ultracode", "win32"), "D:/src/.opencode/plugins/open-ultracode")
    assert.equal(normalizePluginPath("/home/me/x/.opencode/plugins/open-ultracode", "linux"), "/home/me/x/.opencode/plugins/open-ultracode")
  })
})

describe("installer agent model editing", () => {
  function agentFile(content: string): string {
    const file = join(configDir(), "agent.md")
    writeFileSync(file, content)
    return file
  }

  it("sets model and variant in the frontmatter only, keeping CRLF line endings", () => {
    const file = agentFile("---\r\ndescription: Panel\r\nmodel: provider/old\r\nmode: subagent\r\n---\r\nBody mentions\r\nmodel: not-frontmatter\r\n")

    setAgentModel(file, ref(models.withMax, "max"))

    assert.equal(
      readFileSync(file, "utf8"),
      `---\r\ndescription: Panel\r\nmodel: ${ref(models.withMax)}\r\nvariant: max\r\nreasoningEffort: max\r\nmode: subagent\r\n---\r\nBody mentions\r\nmodel: not-frontmatter\r\n`
    )
    assert.equal(getAgentModel(file), ref(models.withMax, "max"))
  })

  it("updates an existing variant and handles a model on the last frontmatter line", () => {
    const withVariant = agentFile("---\nmodel: a/b\nvariant: low\nreasoningEffort: low\n---\n")
    const lastLine = agentFile("---\r\nmode: subagent\r\nmodel: a/b\r\n---\r\n")

    setAgentModel(withVariant, "c/d#max")
    setAgentModel(lastLine, "c/d#max")

    assert.equal(readFileSync(withVariant, "utf8"), "---\nmodel: c/d\nvariant: max\nreasoningEffort: max\n---\n")
    assert.equal(readFileSync(lastLine, "utf8"), "---\r\nmode: subagent\r\nmodel: c/d\r\nvariant: max\r\nreasoningEffort: max\r\n---\r\n")
  })

  it("removes variant and reasoningEffort for a plain model, for models that declare no variants", () => {
    // OpenCode refuses to start an agent whose variant its model does not declare ("Variant unavailable").
    const file = agentFile(`---\r\ndescription: Panel\r\nmodel: ${ref(models.withMax)}\r\nvariant: max\r\nreasoningEffort: max\r\nmode: subagent\r\n---\r\nBody\r\n`)

    setAgentModel(file, ref(models.noVariants))

    assert.equal(readFileSync(file, "utf8"), `---\r\ndescription: Panel\r\nmodel: ${ref(models.noVariants)}\r\nmode: subagent\r\n---\r\nBody\r\n`)
    assert.equal(getAgentModel(file), ref(models.noVariants))
  })

  it("treats legacy placeholders and missing files as unset", () => {
    assert.equal(getAgentModel(agentFile("---\nmodel: provider/model-a\n---\n")), undefined)
    assert.equal(getAgentModel(join(tmpdir(), "missing-open-ultracode-agent.md")), undefined)
  })

  it("rejects invalid model IDs before writing", () => {
    const file = agentFile("---\nmodel: a/b\n---\n")

    assert.throws(() => setAgentModel(file, "not a model"), /must be provider\/model/u)
    assert.equal(readFileSync(file, "utf8"), "---\nmodel: a/b\n---\n")
  })
})

describe("installer summary", () => {
  it("reports the installed plugin entry, fusion models, and assets as found on disk", () => {
    const source = configDir({ "package.json": JSON.stringify({ version: "9.9.9" }) })
    const target = configDir()
    for (const [kind, names] of [["commands", ["ultracode.md", "ultrathink.md"]], ["agents", ["ultracode-fusion-panel-a.md", "ultracode-fusion-panel-b.md", "ultracode-fusion-arbiter.md"]]] as const) {
      for (const directory of [source, target]) {
        mkdirSync(join(directory, ".opencode", kind), { recursive: true })
        mkdirSync(join(target, kind), { recursive: true })
        for (const name of names) writeFileSync(join(directory, ".opencode", kind, name), "---\nmodel: a/b\n---\n")
      }
      for (const name of names) writeFileSync(join(target, kind, name), "---\nmodel: a/b\n---\n")
    }
    setAgentModel(join(target, "agents", "ultracode-fusion-panel-a.md"), ref(models.withMax, "max"))
    registerPlugin({ configDir: target, pluginPath: join(source, ".opencode", "plugins", "open-ultracode") })

    const summary = installSummary({ configDir: target, sourceDir: source }).join("\n")

    assert.match(summary, /^OpenUltraCode 9\.9\.9 installed$/mu)
    assert.match(summary, /Plugin entry: {4}\S+\/\.opencode\/plugins\/open-ultracode$/mu)
    assert.ok(summary.split("\n").includes(`  Fusion panel A:  ${ref(models.withMax)} (variant max)`), summary)
    assert.match(summary, /Fusion arbiter: {2}a\/b$/mu)
    assert.match(summary, /Commands: {8}\/ultracode \/ultrathink$/mu)
    assert.match(summary, /Agents: {10}3 installed/mu)
  })
})

describe("installer model list", () => {
  it("lists the user's providers before opencode's hosted catalog", () => {
    assert.deepEqual(
      orderModels([`${catalogA}/hosted-1`, ref(models.withMax), `${catalogB}/hosted-2`, ref(models.small), ref(models.withMax)]),
      [ref(models.withMax), ref(models.small), `${catalogA}/hosted-1`, `${catalogB}/hosted-2`]
    )
  })

  it("reads model IDs from opencode models output and from the user's config", () => {
    assert.deepEqual(parseModelList(`${catalogA}/a\r\n${providers.user}/b\nnot a model\n  ${providers.other}/c  \n`), [`${catalogA}/a`, `${providers.user}/b`, `${providers.other}/c`])
    assert.deepEqual(
      configuredModels({ model: ref(models.withMax, "max"), small_model: ref(models.small), provider: { [providers.other]: { models: { "local-model": {} } } } }),
      [ref(models.withMax), ref(models.small), `${providers.other}/local-model`]
    )
  })

  it("retries opencode models while plugins are activating and keeps configured models when it never succeeds", () => {
    const dir = configDir({ "opencode.jsonc": `{ // mine\n "model": "${ref(models.withMax)}" }` })
    let calls = 0
    const flaky = () => (++calls < 3 ? { ok: false, stdout: "" } : { ok: true, stdout: `${catalogA}/hosted-1\n${ref(models.small)}\n` })

    assert.deepEqual(listModels({ configDir: dir, run: flaky, delayMs: 1 }), [ref(models.withMax), ref(models.small), `${catalogA}/hosted-1`])
    assert.equal(calls, 3)
    assert.deepEqual(listModels({ configDir: dir, run: () => ({ ok: false, stdout: "" }), delayMs: 1 }), [ref(models.withMax)])
  })
})

describe("installer-lib command line", () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, [libPath, ...args], { encoding: "utf8" })
  }

  it("exits non-zero with a readable message on invalid input", () => {
    const invalid = run("validate-model", "bogus")
    const broken = run("register", "--config-dir", configDir({ "opencode.json": "{ nope" }), "--plugin-path", devPlugin)
    const unknown = run("frobnicate")

    for (const result of [invalid, broken, unknown]) {
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /^OpenUltraCode installer: /u)
    }
  })

  it("runs when started through a symlinked directory (macOS /var -> /private/var)", () => {
    const real = mkdtempSync(join(tmpdir(), "open-ultracode-real-"))
    cpSync(libPath, join(real, "installer-lib.mjs"))
    const link = join(mkdtempSync(join(tmpdir(), "open-ultracode-link-")), "scripts")
    symlinkSync(real, link, "junction")

    const result = spawnSync(process.execPath, [join(link, "installer-lib.mjs"), "validate-model", "bogus"], { encoding: "utf8" })

    assert.equal(result.status, 1, "the command must run and reject the invalid model instead of exiting silently")
  })

  it("registers through the command line", () => {
    const dir = configDir()

    const result = run("register", "--config-dir", dir, "--plugin-path", devPlugin)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(ourPlugins(readJson(dir)).length, 1)
  })
})
