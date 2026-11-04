import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { applyHighEffortRequestBehavior, selectReasoningEffort } from "../src/index.js"

// Variants as opencode 2.2.5 reports them (ctx.model.list()) for the models in these tests.
const vibeMistralLarge4 = { outputTokens: 256000, variants: ["low", "high", "max"] }
const vibeMistralLargeLatest = { outputTokens: 256000, variants: [] }
const opencodeMistralLarge4 = { variants: ["none", "high"] }

describe("high-effort request behavior", () => {
  it("sends the strongest reasoning effort the model declares, up to the configured level", () => {
    const options: Record<string, unknown> = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, vibeMistralLarge4)

    assert.deepEqual(result, { appliedFields: ["maxTokens", "reasoningEffort"] })
    // "max" is stronger than xhigh, and xhigh itself is not declared: "high" is the strongest allowed value.
    assert.deepEqual(options, { maxTokens: 64000, reasoningEffort: "high", temperature: 0.2 })
    assert.equal("reasoning_effort" in options, false)
    assert.equal("max_tokens" in options, false)
  })

  it("sends no reasoning effort to a model that declares no variants", () => {
    // Captured: vibe-oidc/mistral-large-latest answers 400 Bad Request to any reasoning_effort.
    const options: Record<string, unknown> = {}

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, vibeMistralLargeLatest)

    assert.deepEqual(result.appliedFields, ["maxTokens"])
    assert.deepEqual(options, { maxTokens: 64000 })
  })

  it("sends no reasoning effort when opencode does not list the model", () => {
    const options: Record<string, unknown> = {}

    applyHighEffortRequestBehavior({ enabled: true, effort: "high", outputTokens: 64000 }, options)

    assert.deepEqual(options, { maxTokens: 64000 })
  })

  it("selects declared efforts only", () => {
    assert.equal(selectReasoningEffort("xhigh", ["low", "high", "max"]), "high")
    assert.equal(selectReasoningEffort("xhigh", ["low", "high", "xhigh", "max"]), "xhigh")
    assert.equal(selectReasoningEffort("medium", ["low", "high", "max"]), "low")
    assert.equal(selectReasoningEffort("high", opencodeMistralLarge4.variants), "high")
    assert.equal(selectReasoningEffort("high", ["none"]), undefined)
    assert.equal(selectReasoningEffort("high", ["fast", "max"]), undefined)
    assert.equal(selectReasoningEffort("high", []), undefined)
    assert.equal(selectReasoningEffort("high", undefined), undefined)
  })

  it("leaves request options untouched when high-effort mode is disabled", () => {
    const options: Record<string, unknown> = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior({ enabled: false, effort: "xhigh", outputTokens: 64000 }, options, vibeMistralLarge4)

    assert.deepEqual(options, { temperature: 0.2 })
    assert.deepEqual(result.appliedFields, [])
  })

  it("never downgrades an already-stronger effort or token budget set by an earlier hook", () => {
    const options: Record<string, unknown> = { reasoningEffort: "max", maxTokens: 128000 }

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, vibeMistralLarge4)

    assert.deepEqual(result.appliedFields, ["maxTokens"])
    assert.deepEqual(options, { reasoningEffort: "max", maxTokens: 128000 })
  })
})
