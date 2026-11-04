import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { configureFusionModels, isModelReference } from "../src/index.js"
import { models, providers, ref } from "./fixtures/models.js"

// Fusion roles that all select a model declaring a max variant.
const defaultFusionModels = {
  panelA: ref(models.withMax, "max"),
  panelB: ref(models.otherFamilyWithMax, "max"),
  decider: ref(models.withMax, "max")
}

describe("fusion model configuration tool", () => {
  it("reads the configured role models without changing valid max-reasoning agents", async () => {
    const root = await createFusionProject(defaultFusionModels)
    const result = await configureFusionModels(root, {})

    assert.equal(result.changed, false)
    assert.deepEqual(result.models, defaultFusionModels)
    assert.equal(result.reasoningEffort, "max")
  })

  it("updates only the changed role and preserves max reasoning", async () => {
    const root = await createFusionProject(defaultFusionModels)
    const panelAPath = join(root, ".opencode", "agents", "ultracode-fusion-panel-a.md")
    const panelABefore = await readFile(panelAPath, "utf8")

    const result = await configureFusionModels(root, { panelB: ref(models.withMax, "max") })

    assert.equal(result.changed, true)
    assert.deepEqual(result.models, {
      ...defaultFusionModels,
      panelB: ref(models.withMax, "max")
    })
    assert.equal(await readFile(panelAPath, "utf8"), panelABefore)
    const panelB = await readFile(join(root, ".opencode", "agents", "ultracode-fusion-panel-b.md"), "utf8")
    assert.ok(panelB.split("\n").includes(`model: ${ref(models.withMax)}`), panelB)
    assert.match(panelB, /^variant: max$/m)
    assert.match(panelB, /^reasoningEffort: max$/m)
    assert.doesNotMatch(panelB, /^thinking:/m)
  })

  it("keeps #max where the provider defines it and selects no variant for a plain model", async () => {
    // Models that declare no variants reject "max": "Variant unavailable for <model>: max".
    const root = await createFusionProject(defaultFusionModels)

    const result = await configureFusionModels(root, { panelA: ref(models.noVariants), decider: ref(models.withMax, "max") })

    assert.equal(result.changed, true)
    assert.equal(result.models.panelA, ref(models.noVariants))
    assert.equal(result.reasoningEffort, "mixed-or-unset")
    const panelA = await readFile(join(root, ".opencode", "agents", "ultracode-fusion-panel-a.md"), "utf8")
    assert.ok(panelA.split("\n").includes(`model: ${ref(models.noVariants)}`), panelA)
    assert.doesNotMatch(panelA, /^(?:variant|reasoningEffort):/m)
    const decider = await readFile(join(root, ".opencode", "agents", "ultracode-fusion-arbiter.md"), "utf8")
    assert.match(decider, /^variant: max$/m)
    assert.match(decider, /^reasoningEffort: max$/m)
    assert.equal((await configureFusionModels(root, {})).models.panelA, ref(models.noVariants), "a plain model must read back without #max")
  })

  it("persists catalog model IDs whose nested model path begins with a sigil", async () => {
    const root = await createFusionProject(defaultFusionModels)

    const result = await configureFusionModels(root, {
      panelA: "cloudflare-workers-ai/@cf/meta/llama-4#max"
    })

    assert.equal(result.models.panelA, "cloudflare-workers-ai/@cf/meta/llama-4#max")
    const panelA = await readFile(join(root, ".opencode", "agents", "ultracode-fusion-panel-a.md"), "utf8")
    assert.match(panelA, /^model: cloudflare-workers-ai\/@cf\/meta\/llama-4$/m)
    assert.match(panelA, /^variant: max$/m)
  })

  it("rejects malformed and non-max variant references before writing any agent", async () => {
    const root = await createFusionProject(defaultFusionModels)
    const panelAPath = join(root, ".opencode", "agents", "ultracode-fusion-panel-a.md")
    const before = await readFile(panelAPath, "utf8")

    await assert.rejects(configureFusionModels(root, { panelA: "not-a-model" }), /provider\/model/)
    await assert.rejects(configureFusionModels(root, { panelA: ref(models.withMax, "high") }), /#max/)
    assert.equal(await readFile(panelAPath, "utf8"), before)
  })

  it("accepts direct and nested provider model references with only the max variant", () => {
    assert.equal(isModelReference(ref(models.withMax)), true)
    assert.equal(isModelReference(`${providers.other}/vendor/nested-model-0813#max`), true)
    assert.equal(isModelReference("cloudflare-workers-ai/@cf/meta/llama-4#max"), true)
    assert.equal(isModelReference(`${providers.other}/~vendor/special-model`), true)
    assert.equal(isModelReference(ref(models.withMax, "high")), false)
    assert.equal(isModelReference("bad model"), false)
    assert.equal(isModelReference("model-only"), false)
  })

  it("edits only YAML frontmatter and preserves CRLF Markdown body examples", async () => {
    const root = await createFusionProject(defaultFusionModels, "\r\n", true)
    const panelAPath = join(root, ".opencode", "agents", "ultracode-fusion-panel-a.md")

    await configureFusionModels(root, { panelA: ref(models.withMax, "max") })

    const content = await readFile(panelAPath, "utf8")
    assert.ok(content.split("\n").includes(`model: ${ref(models.withMax)}\r`), content)
    assert.match(content, /^variant: max\r$/m)
    assert.match(content, /Example body metadata:\r\nmodel: docs\/example#high\r\n/)
    assert.doesNotMatch(content, /^thinking:/m)
    assert.doesNotMatch(content, /(?<!\r)\n/u)
  })

  it("fails closed when a higher-precedence project scope has only some fusion agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-ultracode-partial-fusion-"))
    const projectAgents = join(root, ".opencode", "agents")
    await mkdir(projectAgents, { recursive: true })
    await writeFile(
      join(projectAgents, "ultracode-fusion-panel-a.md"),
      fusionAgent(defaultFusionModels.panelA),
      "utf8"
    )

    await assert.rejects(configureFusionModels(root, {}), /partial fusion-agent override/i)
  })
})

async function createFusionProject(
  models: typeof defaultFusionModels,
  newline: "\n" | "\r\n" = "\n",
  includeLegacyThinking = false
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "open-ultracode-fusion-config-"))
  const directory = join(root, ".opencode", "agents")
  await mkdir(directory, { recursive: true })

  await Promise.all([
    writeFile(
      join(directory, "ultracode-fusion-panel-a.md"),
      fusionAgent(models.panelA, newline, includeLegacyThinking),
      "utf8"
    ),
    writeFile(
      join(directory, "ultracode-fusion-panel-b.md"),
      fusionAgent(models.panelB, newline, includeLegacyThinking),
      "utf8"
    ),
    writeFile(
      join(directory, "ultracode-fusion-arbiter.md"),
      fusionAgent(models.decider, newline, includeLegacyThinking),
      "utf8"
    )
  ])
  return root
}

function fusionAgent(
  model: string,
  newline: "\n" | "\r\n" = "\n",
  includeLegacyThinking = false
): string {
  const thinking = includeLegacyThinking ? "thinking:\n  type: enabled\n" : ""
  const baseModel = model.replace(/#max$/u, "")
  return `---
description: Fusion role.
mode: subagent
model: ${baseModel}
variant: max
reasoningEffort: max
${thinking}permission:
  edit: deny
  bash: deny
  open_ultracode_configure_fusion: deny
---

Use supplied context and return structured round output.

Example body metadata:
model: docs/example#high
`.replaceAll("\n", newline)
}
