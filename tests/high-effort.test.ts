import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { applyHighEffortRequestBehavior } from "../src/index.js"

describe("high-effort request behavior", () => {
  it("applies semantic output-token and reasoning-effort options", () => {
    const options: Record<string, unknown> = {
      temperature: 0.2
    }

    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "xhigh", outputTokens: 64000 },
      options
    )

    assert.deepEqual(result, { appliedFields: ["maxTokens", "reasoningEffort"] })
    assert.deepEqual(options, {
      maxTokens: 64000,
      reasoningEffort: "high",
      temperature: 0.2
    })
    assert.equal("reasoning_effort" in options, false)
    assert.equal("max_tokens" in options, false)
  })

  it("maps medium effort to the medium provider effort level", () => {
    const options: Record<string, unknown> = {}

    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "medium", outputTokens: 64000 },
      options
    )

    assert.deepEqual(result.appliedFields, ["maxTokens", "reasoningEffort"])
    assert.equal(options.reasoningEffort, "medium")
  })

  it("leaves request options untouched when high-effort mode is disabled", () => {
    const options: Record<string, unknown> = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior(
      { enabled: false, effort: "xhigh", outputTokens: 64000 },
      options
    )

    assert.deepEqual(options, { temperature: 0.2 })
    assert.deepEqual(result.appliedFields, [])
  })

  it("never downgrades an already-stronger effort or token budget set by an earlier hook", () => {
    const options: Record<string, unknown> = {
      reasoningEffort: "max",
      maxTokens: 128000
    }

    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "xhigh", outputTokens: 64000 },
      options
    )

    assert.deepEqual(result.appliedFields, ["maxTokens", "reasoningEffort"])
    assert.deepEqual(options, {
      reasoningEffort: "max",
      maxTokens: 128000
    })
  })
})
