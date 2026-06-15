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
  "scripts/validate-assets.ts"
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

    assert.equal(config.$schema, "https://opencode.ai/config.json")
    assert.deepEqual(config.plugin, ["./.opencode/plugins/open-ultracode.ts"])
    assert.deepEqual(config.skills, { paths: [".opencode/skills"] })
    assert.equal("model" in config, false)
    assert.equal("provider" in config, false)

    assert.deepEqual(manifest.files, [
      ".opencode",
      "src",
      "docs",
      "scripts/validate-assets.ts",
      "README.md",
      "opencode.json"
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

  writeFileSync(join(root, "package.json"), JSON.stringify({ files: [".opencode", "src", "docs", "scripts/validate-assets.ts", "README.md", "opencode.json"] }))
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
  return root
}

function skillAsset(): string {
  return `---
name: open-ultracode
description: Use when running OpenUltraCode workflows.
---

# OpenUltraCode

Use the active selected model. Do not change provider. Ask for missing task context.
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

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}
