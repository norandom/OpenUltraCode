import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { checkReferences, checkSubagentSession, fetchModelList, parseRunEvents, runtimeCheck } from "../scripts/runtime-check.mjs"
import { absentProviderModel, modelList, models, providers, ref, unlistedModel } from "./fixtures/models.js"

// Event and session-export shapes as opencode 2.2.5 emits them; identifiers are synthetic.
const variantUnavailable = `Variant unavailable for ${ref(models.noVariants)}: max`

const completedDispatch = JSON.stringify({
  type: "tool_use",
  part: {
    type: "tool",
    tool: "subagent",
    state: {
      status: "completed",
      input: { agent: "ultracode-fusion-panel-a", prompt: "Reply with the single word OK." },
      output: "<subagent sessionID=\"ses_child_a\" state=\"completed\">\nOK\n</subagent>",
      metadata: { metadata: { sessionID: "ses_child_a", status: "completed" } }
    }
  }
})
const failedDispatch = JSON.stringify({
  type: "tool_use",
  part: { type: "tool", tool: "subagent", state: { status: "error", input: { agent: "ultracode-fusion-panel-b" }, error: variantUnavailable } }
})

describe("runtime check", () => {
  it("flags fusion references that the running opencode cannot serve", () => {
    assert.deepEqual(checkReferences(modelList, {
      coordinator: ref(models.withMax),
      "ultracode-fusion-panel-a": ref(models.noVariants),
      "ultracode-fusion-panel-b": ref(models.withMax, "max")
    }), [])
    assert.deepEqual(checkReferences(modelList, {
      "ultracode-fusion-panel-a": ref(models.noVariants, "max"),
      "ultracode-fusion-panel-b": absentProviderModel,
      "ultracode-fusion-arbiter": unlistedModel,
      coordinator: undefined
    }), [
      `ultracode-fusion-panel-a: ${ref(models.noVariants, "max")} selects variant "max", but opencode reports no variants for it`,
      `ultracode-fusion-panel-b: provider ${providers.absent} is not available in the running opencode (${absentProviderModel})`,
      `ultracode-fusion-arbiter: opencode does not list ${unlistedModel}`,
      "coordinator: no model configured"
    ])
  })

  it("reads subagent dispatches and their failures from opencode's JSON event stream", () => {
    const { subagents, errors } = parseRunEvents([
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      completedDispatch,
      failedDispatch,
      "not json",
      JSON.stringify({ type: "error", error: { name: "APIError", message: "Bad Request" } })
    ].join("\n"))

    assert.deepEqual(subagents, [
      { agent: "ultracode-fusion-panel-a", status: "completed", childSessionID: "ses_child_a", error: undefined },
      { agent: "ultracode-fusion-panel-b", status: "error", childSessionID: undefined, error: variantUnavailable }
    ])
    assert.deepEqual(errors, ["{\"name\":\"APIError\",\"message\":\"Bad Request\"}"])
  })

  it("requires the subagent session to run on the configured model and variant", () => {
    const model = models.noVariants
    const exported = { info: { agent: "ultracode-fusion-panel-a", model: { id: model.id, providerID: model.providerID, variant: "default" }, outcome: "succeeded" } }

    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", ref(model), exported), [])
    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", ref(model, "max"), exported), [
      "ultracode-fusion-panel-a: ran with variant default, expected max"
    ])
    // A silent fallback to another model must fail the check.
    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", ref(models.otherFamilyWithMax), { info: { ...exported.info, outcome: "failed" } }), [
      `ultracode-fusion-panel-a: ran on ${ref(model)}, expected ${ref(models.otherFamilyWithMax)}`,
      "ultracode-fusion-panel-a: subagent outcome failed"
    ])
  })

  it("accepts a fresh config without a coordinator model and lets project agents shadow global ones", () => {
    // A fresh config without `model` is valid: opencode then uses its default model.
    const configDir = mkdtempSync(join(tmpdir(), "open-ultracode-runtime-config-"))
    const project = mkdtempSync(join(tmpdir(), "open-ultracode-runtime-project-"))
    const agent = (reference: string) => `---\nmode: subagent\nmodel: ${reference}\n---\nRole.\n`
    mkdirSync(join(configDir, "agents"))
    mkdirSync(join(project, ".opencode", "agents"), { recursive: true })
    writeFileSync(join(configDir, "opencode.json"), "{}\n")
    writeFileSync(join(configDir, "agents", "ultracode-fusion-panel-a.md"), agent(ref(models.noVariants)))
    writeFileSync(join(configDir, "agents", "ultracode-fusion-panel-b.md"), agent(ref(models.otherFamilyWithMax)))
    writeFileSync(join(configDir, "agents", "ultracode-fusion-arbiter.md"), agent(ref(models.withMax)))
    writeFileSync(join(project, ".opencode", "agents", "ultracode-fusion-panel-a.md"), agent(absentProviderModel))

    const global = runtimeCheck({ configDir, fetchModels: () => [...modelList] })
    const inProject = runtimeCheck({ configDir, directory: project, fetchModels: () => [...modelList] })

    assert.deepEqual(global.problems, [])
    assert.deepEqual(inProject.problems, [`ultracode-fusion-panel-a: provider ${providers.absent} is not available in the running opencode (${absentProviderModel})`])
  })

  it("retries the model list while opencode's plugins are still activating", () => {
    let calls = 0
    const run = () => (++calls < 3
      ? { ok: false, stdout: "{\"_tag\":\"ServiceUnavailableError\",\"message\":\"Location plugins did not finish activating\"}", stderr: "HTTP 503" }
      : { ok: true, stdout: JSON.stringify({ data: modelList }), stderr: "" })

    assert.deepEqual(fetchModelList(run, { delayMs: 1 }), modelList)
    assert.equal(calls, 3)
    assert.throws(() => fetchModelList(() => ({ ok: false, stdout: "", stderr: "connection refused" }), { attempts: 2, delayMs: 1 }), /model\.list failed: connection refused/u)
  })
})

// Opt-in: check the REAL installation (the developer's opencode and ~/.config/opencode),
// whatever providers it has. The pre-push hook runs the same check before a release tag.
describe("runtime check against the installed opencode", { skip: process.env.OPENULTRACODE_RUNTIME !== "1" && "set OPENULTRACODE_RUNTIME=1 to check the real opencode installation" }, () => {
  it("serves the coordinator and every fusion agent, and each fusion agent answers through a real dispatch", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "runtime-check.mjs"), "--live"], { encoding: "utf8", timeout: 900_000 })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  })
})
