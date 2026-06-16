import { existsSync, mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"

import { validateAssets } from "../scripts/validate-assets.js"

const projectRoot = process.cwd()

const requiredScaffoldPaths = [
  "src",
  ".opencode/plugins",
  ".opencode/plugins/open-ultracode.ts",
  ".opencode/skills/open-ultracode",
  ".opencode/agents",
  ".opencode/commands",
  "docs",
  "tests",
  "scripts/validate-assets.ts",
  "install.sh",
  "pnpm-workspace.yaml"
] as const

describe("OpenUltraCode scaffold", () => {
  for (const relativePath of requiredScaffoldPaths) {
    it(`contains ${relativePath}`, () => {
      assert.equal(existsSync(join(projectRoot, relativePath)), true)
    })
  }

  it("validates the project opencode assets", () => {
    const result = validateAssets(projectRoot)

    assert.equal(result.ok, true, result.errors.join("\n"))
  })

  it("exposes an installable opencode project layout without model routing", () => {
    const config = readJson(join(projectRoot, "opencode.json"))
    const manifest = readJson(join(projectRoot, "package.json"))
    const scripts = manifest.scripts as Record<string, unknown>
    const pnpmWorkspace = readFileSync(join(projectRoot, "pnpm-workspace.yaml"), "utf8")
    const installer = readFileSync(join(projectRoot, "install.sh"), "utf8")

    assert.equal(config.$schema, "https://opencode.ai/config.json")
    assert.deepEqual(config.plugin, ["./.opencode/plugins/open-ultracode.ts"])
    assert.deepEqual(config.skills, { paths: [".opencode/skills"] })
    assert.equal("model" in config, false)
    assert.equal("provider" in config, false)
    assert.equal(manifest.packageManager, "pnpm@11.4.0")
    assert.equal(manifest.version, "0.1.2")
    assert.equal(scripts.eslint, "eslint .")
    assert.equal(scripts.lint, "dagger call lint --source .")
    assert.equal(scripts.check, "pnpm run build && pnpm run lint && pnpm run test && pnpm run validate:assets")
    assert.match(pnpmWorkspace, /^allowBuilds:\n {2}esbuild: true$/m)
    assert.match(pnpmWorkspace, /^minimumReleaseAge: 4320$/m)
    assert.match(installer, /OPENCODE_CONFIG_DIR="\$\{OPENCODE_CONFIG_DIR:-\$HOME\/\.config\/opencode\}"/)
    assert.match(installer, /\.opencode\/skills\/open-ultracode/)
    assert.match(installer, /\.opencode\/commands\/ultracode\*\.md/)
    assert.match(installer, /\.opencode\/agents\/open-ultracode\*\.md/)
    assert.match(installer, /\.opencode\/agents\/ultracode-fusion\*\.md/)
    assert.match(installer, /OPENCODE_PLUGIN_PATH/)

    assert.deepEqual(manifest.files, [
      ".opencode",
      "src",
      "docs",
      "scripts/validate-assets.ts",
      "README.md",
      "install.sh",
      "eslint.config.js",
      "dagger.json",
      ".dagger",
      ".githooks",
      "opencode.json",
      "pnpm-workspace.yaml"
    ])
  })

  it("rejects missing required opencode assets", () => {
    const root = createAssetFixture()
    writeFileSync(join(root, ".opencode/skills/open-ultracode/SKILL.md"), "")

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /open-ultracode\/SKILL\.md.*frontmatter/i)
  })

  it("rejects a missing project opencode configuration", () => {
    const root = createAssetFixture()
    unlinkSync(join(root, "opencode.json"))

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /opencode\.json is missing/i)
  })

  it("rejects hardcoded model fields in command and agent assets", () => {
    const root = createAssetFixture()
    writeFileSync(
      join(root, ".opencode/commands/ultracode.md"),
      commandAsset("Run comprehensive workflow", "comprehensive", "model: anthropic/claude-sonnet-4-6")
    )
    writeFileSync(
      join(root, ".opencode/agents/open-ultracode.md"),
      agentAsset("Coordinator", "model: anthropic/claude-sonnet-4-6")
    )

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /commands\/ultracode\.md.*model/i)
    assert.match(result.errors.join("\n"), /agents\/open-ultracode\.md.*model/i)
  })

  it("allows model frontmatter only for approved fusion agents", () => {
    const root = createAssetFixture()
    writeFileSync(
      join(root, ".opencode/agents/ultracode-fusion-panel-a.md"),
      fusionAgentAsset("Fusion panel A", "openai/gpt-5")
    )
    writeFileSync(
      join(root, ".opencode/agents/not-fusion.md"),
      agentAsset("Unexpected model", "model: openai/gpt-5\npermission:\n  edit: deny\n  bash: deny")
    )

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /agents\/not-fusion\.md.*model/i)
    assert.doesNotMatch(result.errors.join("\n"), /ultracode-fusion-panel-a\.md.*model/i)
  })

  it("rejects unsafe agent permissions", () => {
    const root = createAssetFixture()
    writeFileSync(
      join(root, ".opencode/agents/open-ultracode-implementer.md"),
      agentAsset("Implementer", "permission:\n  edit: allow\n  bash: ask")
    )

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /open-ultracode-implementer\.md.*edit.*allow/i)
  })

  it("rejects top-level allow-all agent permissions", () => {
    const root = createAssetFixture()
    writeFileSync(join(root, ".opencode/agents/open-ultracode.md"), agentAsset("Coordinator", "permission: allow"))

    const result = validateAssets(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /open-ultracode\.md.*permission.*allow/i)
  })
})

function createAssetFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "open-ultracode-assets-"))
  for (const relativePath of [
    "src",
    ".opencode/plugins",
    ".opencode/skills/open-ultracode",
    ".opencode/agents",
    ".opencode/commands",
    "docs",
    "tests",
    "scripts"
  ]) {
    mkdirSync(join(root, relativePath), { recursive: true })
  }

  writeFileSync(join(root, "package.json"), JSON.stringify({
    version: "0.1.1",
    packageManager: "pnpm@11.4.0",
    scripts: {
      eslint: "eslint .",
      lint: "dagger call lint --source .",
      check: "pnpm run build && pnpm run lint && pnpm run test && pnpm run validate:assets"
    },
    files: [".opencode", "src", "docs", "scripts/validate-assets.ts", "README.md", "install.sh", "eslint.config.js", "dagger.json", ".dagger", ".githooks", "opencode.json", "pnpm-workspace.yaml"]
  }))
  writeFileSync(
    join(root, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugin: ["./.opencode/plugins/open-ultracode.ts"],
      skills: { paths: [".opencode/skills"] }
    })
  )
  writeFileSync(join(root, "tsconfig.json"), "{}\n")
  writeFileSync(join(root, "README.md"), "# OpenUltraCode\n")
  writeFileSync(join(root, "install.sh"), "#!/usr/bin/env sh\n")
  writeFileSync(join(root, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\nminimumReleaseAge: 4320\n")
  writeFileSync(join(root, "scripts/validate-assets.ts"), "")

  writeFileSync(join(root, ".opencode/plugins/open-ultracode.ts"), "export default async () => ({})\n")
  writeFileSync(join(root, ".opencode/skills/open-ultracode/SKILL.md"), skillAsset())
  for (const command of [
    ["ultracode.md", "comprehensive"],
    ["ultracode-debug.md", "debug"],
    ["ultracode-spec-audit.md", "spec-audit"],
    ["ultracode-research.md", "adversarial-research"],
    ["ultracode-verify.md", "verify"]
  ] as const) {
    writeFileSync(join(root, ".opencode/commands", command[0]), commandAsset("Run workflow", command[1]))
  }
    for (const agent of [
      ["open-ultracode.md", "Coordinator"],
    ["open-ultracode-planner.md", "Planner"],
    ["open-ultracode-implementer.md", "Implementer"],
    ["open-ultracode-adversary.md", "Adversary"],
    ["open-ultracode-reconciler.md", "Reconciler"],
      ["open-ultracode-verifier.md", "Verifier"],
      ["open-ultracode-researcher.md", "Researcher"]
    ] as const) {
      writeFileSync(join(root, ".opencode/agents", agent[0]), agentAsset(agent[1]))
    }
    for (const agent of [
      ["ultracode-fusion-panel-a.md", "Fusion panel A", "provider/model-a"],
      ["ultracode-fusion-panel-b.md", "Fusion panel B", "provider/model-b"],
      ["ultracode-fusion-arbiter.md", "Fusion arbiter", "provider/arbiter-model"]
    ] as const) {
      writeFileSync(join(root, ".opencode/agents", agent[0]), fusionAgentAsset(agent[1], agent[2]))
    }
  return root
}

function skillAsset(): string {
  return `---
name: open-ultracode
description: Use when running OpenUltraCode workflows.
---

# OpenUltraCode

Use the active selected model. Do not change provider. Ask for missing task context. Record verification evidence.
`
}

function commandAsset(description: string, mode: string, extraFrontmatter = ""): string {
  return `---
description: ${description}
${extraFrontmatter}
---

# Command

Workflow mode: ${mode}

Use $ARGUMENTS. Preserve the selected model. Ask focused questions when missing task context is present.
`
}

function agentAsset(description: string, permission = "permission:\n  edit: ask\n  bash: ask"): string {
  return `---
description: ${description}
mode: subagent
${permission}
---

# Agent

Inherit the active selected model. Do not change provider. Return structured output.
`
}

function fusionAgentAsset(description: string, model: string): string {
  return `---
description: ${description}
mode: subagent
model: ${model}
permission:
  edit: deny
  bash: deny
---

# Fusion Agent

Use only the supplied context. Return structured round output. Do not introduce a proxy, synthetic model ID, or provider route.
`
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}
