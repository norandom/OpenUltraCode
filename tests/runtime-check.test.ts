import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { checkReferences, checkSubagentSession, fetchModelList, parseRunEvents } from "../scripts/runtime-check.mjs"

// Shapes recorded from opencode 2.2.5 on a machine with the vibe-oidc provider.
const models = [
  { providerID: "vibe-oidc", id: "mistral-large-4", variants: [{ id: "low" }, { id: "high" }, { id: "max" }] },
  { providerID: "vibe-oidc", id: "mistral-large-latest", variants: [] },
  { providerID: "vibe-oidc", id: "zai-glm-5-3", variants: [{ id: "low" }, { id: "high" }, { id: "max" }] }
]

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
  part: {
    type: "tool",
    tool: "subagent",
    state: { status: "error", input: { agent: "ultracode-fusion-panel-b" }, error: "Variant unavailable for vibe-oidc/mistral-large-latest: max" }
  }
})

describe("runtime check", () => {
  it("flags fusion references that the running opencode cannot serve", () => {
    assert.deepEqual(checkReferences(models, {
      coordinator: "vibe-oidc/mistral-large-4",
      "ultracode-fusion-panel-a": "vibe-oidc/mistral-large-latest",
      "ultracode-fusion-panel-b": "vibe-oidc/zai-glm-5-3#max"
    }), [])
    assert.deepEqual(checkReferences(models, {
      "ultracode-fusion-panel-a": "vibe-oidc/mistral-large-latest#max",
      "ultracode-fusion-panel-b": "absent/model",
      "ultracode-fusion-arbiter": "vibe-oidc/mistral-large-5",
      coordinator: undefined
    }), [
      "ultracode-fusion-panel-a: vibe-oidc/mistral-large-latest#max selects variant \"max\", but opencode reports no variants for it",
      "ultracode-fusion-panel-b: provider absent is not available in the running opencode (absent/model)",
      "ultracode-fusion-arbiter: opencode does not list vibe-oidc/mistral-large-5",
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
      { agent: "ultracode-fusion-panel-b", status: "error", childSessionID: undefined, error: "Variant unavailable for vibe-oidc/mistral-large-latest: max" }
    ])
    assert.deepEqual(errors, ["{\"name\":\"APIError\",\"message\":\"Bad Request\"}"])
  })

  it("requires the subagent session to run on the configured model and variant", () => {
    const exported = { info: { agent: "ultracode-fusion-panel-a", model: { id: "mistral-large-latest", providerID: "vibe-oidc", variant: "default" }, outcome: "succeeded" } }

    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", "vibe-oidc/mistral-large-latest", exported), [])
    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", "vibe-oidc/mistral-large-latest#max", exported), [
      "ultracode-fusion-panel-a: ran with variant default, expected max"
    ])
    // A silent fallback to the coordinator's model must fail the check.
    assert.deepEqual(checkSubagentSession("ultracode-fusion-panel-a", "vibe-oidc/zai-glm-5-3", { info: { ...exported.info, outcome: "failed" } }), [
      "ultracode-fusion-panel-a: ran on vibe-oidc/mistral-large-latest, expected vibe-oidc/zai-glm-5-3",
      "ultracode-fusion-panel-a: subagent outcome failed"
    ])
  })

  it("retries the model list while opencode's plugins are still activating", () => {
    let calls = 0
    const run = () => (++calls < 3
      ? { ok: false, stdout: "{\"_tag\":\"ServiceUnavailableError\",\"message\":\"Location plugins did not finish activating\"}", stderr: "HTTP 503" }
      : { ok: true, stdout: JSON.stringify({ data: models }), stderr: "" })

    assert.deepEqual(fetchModelList(run, { delayMs: 1 }), models)
    assert.equal(calls, 3)
    assert.throws(() => fetchModelList(() => ({ ok: false, stdout: "", stderr: "connection refused" }), { attempts: 2, delayMs: 1 }), /model\.list failed: connection refused/u)
  })
})

// Opt-in: check the REAL installation (the developer's opencode and ~/.config/opencode).
// The pre-push hook runs the same check before a release tag is pushed.
describe("runtime check against the installed opencode", { skip: process.env.OPENULTRACODE_RUNTIME !== "1" && "set OPENULTRACODE_RUNTIME=1 to check the real opencode installation" }, () => {
  it("serves the coordinator and every fusion agent, and each fusion agent answers through a real dispatch", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "runtime-check.mjs"), "--live"], { encoding: "utf8", timeout: 900_000 })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  })
})
