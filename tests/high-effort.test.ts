import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { applyHighEffortRequestBehavior } from "../src/index.js"

describe("high-effort request behavior", () => {
  it("applies supported token and nested reasoning controls without inventing fields", () => {
    const params = {
      maxTokens: 2048,
      reasoning: {
        effort: "medium"
      },
      temperature: 0.2
    }

    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "xhigh", outputTokens: 64000 },
      params
    )

    assert.deepEqual(result, { appliedFields: ["maxTokens", "reasoning.effort"] })
    assert.deepEqual(params, {
      maxTokens: 64000,
      reasoning: {
        effort: "high"
      },
      temperature: 0.2
    })
    assert.equal("reasoning_effort" in params, false)
    assert.equal("max_tokens" in params, false)
  })

  it("reports unsupported controls without hidden reasoning or provider-limit claims", () => {
    const params = { temperature: 0.2 }

    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "xhigh", outputTokens: 64000 },
      params
    )

    assert.deepEqual(params, { temperature: 0.2 })
    assert.deepEqual(result.appliedFields, [])
    assert.equal(result.degradation?.id, "high-effort-limitation")
    assert.doesNotMatch(result.degradation?.userVisibleMessage ?? "", /hidden reasoning|chain-of-thought|bypass/i)
    assert.doesNotMatch(result.degradation?.safeNextAction ?? "", /hidden reasoning|chain-of-thought|bypass/i)
  })
})
