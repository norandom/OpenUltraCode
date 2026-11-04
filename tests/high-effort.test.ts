import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { applyHighEffortRequestBehavior, selectReasoningEffort } from "../src/index.js"
import { models } from "./fixtures/models.js"

const limitsOf = (model: { variants: ReadonlyArray<{ id: string }>; limit?: { output: number } }) => ({
  ...(model.limit === undefined ? {} : { outputTokens: model.limit.output }),
  variants: model.variants.map((variant) => variant.id)
})
const withMax = limitsOf(models.withMax)
const noVariants = limitsOf(models.noVariants)
const noneAndHigh = limitsOf(models.sameModelOtherProvider)

describe("high-effort request behavior", () => {
  it("sends the strongest reasoning effort the model declares, up to the configured level", () => {
    const options: Record<string, unknown> = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, withMax)

    assert.deepEqual(result, { appliedFields: ["maxTokens", "reasoningEffort"] })
    // "max" is stronger than xhigh, and xhigh itself is not declared: "high" is the strongest allowed value.
    assert.deepEqual(options, { maxTokens: 64000, reasoningEffort: "high", temperature: 0.2 })
    assert.equal("reasoning_effort" in options, false)
    assert.equal("max_tokens" in options, false)
  })

  it("sends no reasoning effort to a model that declares no variants", () => {
    // Providers answer 400 Bad Request to a reasoning_effort for a model that declares no variants.
    const options: Record<string, unknown> = {}

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, noVariants)

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
    assert.equal(selectReasoningEffort("high", noneAndHigh.variants), "high")
    assert.equal(selectReasoningEffort("high", ["none"]), undefined)
    assert.equal(selectReasoningEffort("high", ["fast", "max"]), undefined)
    assert.equal(selectReasoningEffort("high", []), undefined)
    assert.equal(selectReasoningEffort("high", undefined), undefined)
  })

  it("leaves request options untouched when high-effort mode is disabled", () => {
    const options: Record<string, unknown> = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior({ enabled: false, effort: "xhigh", outputTokens: 64000 }, options, withMax)

    assert.deepEqual(options, { temperature: 0.2 })
    assert.deepEqual(result.appliedFields, [])
  })

  it("never downgrades an already-stronger effort or token budget set by an earlier hook", () => {
    const options: Record<string, unknown> = { reasoningEffort: "max", maxTokens: 128000 }

    const result = applyHighEffortRequestBehavior({ enabled: true, effort: "xhigh", outputTokens: 64000 }, options, withMax)

    assert.deepEqual(result.appliedFields, ["maxTokens"])
    assert.deepEqual(options, { reasoningEffort: "max", maxTokens: 128000 })
  })
})
