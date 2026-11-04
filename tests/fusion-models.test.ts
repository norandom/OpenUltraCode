import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { analyzeFusionModels, describeFusionModelIssue, type ModelInfoSummary } from "../src/index.js"

// Variants as opencode 2.2.5 reports them on a machine with the vibe-oidc provider.
const models: ModelInfoSummary[] = [
  { providerID: "vibe-oidc", id: "mistral-large-4", variants: [{ id: "low" }, { id: "high" }, { id: "max" }] },
  { providerID: "vibe-oidc", id: "mistral-large-latest", variants: [] },
  { providerID: "vibe-oidc", id: "mistral-large-2512", variants: [] },
  { providerID: "vibe-oidc", id: "zai-glm-5-3", variants: [{ id: "low" }, { id: "high" }, { id: "max" }] },
  { providerID: "opencode", id: "kimi-k3", variants: [{ id: "low" }, { id: "high" }, { id: "max" }] }
]

describe("fusion model fallbacks", () => {
  it("accepts models and variants that opencode reports", () => {
    assert.deepEqual(analyzeFusionModels(models, {
      panelA: "vibe-oidc/mistral-large-latest",
      panelB: "vibe-oidc/zai-glm-5-3#max",
      decider: "opencode/kimi-k3#max"
    }), [])
  })

  it("falls back to the same model without the variant, then to similar models that declare it", () => {
    const [issue] = analyzeFusionModels(models, { panelA: "vibe-oidc/mistral-large-latest#max" })

    assert.deepEqual(issue, {
      role: "panelA",
      reference: "vibe-oidc/mistral-large-latest#max",
      problem: "variant-unavailable",
      variants: [],
      fallback: "vibe-oidc/mistral-large-latest",
      alternatives: ["vibe-oidc/mistral-large-4#max", "vibe-oidc/zai-glm-5-3#max"]
    })
    assert.match(describeFusionModelIssue(issue!), /no "max" variant .*declares no variants.*Suggested fallback: vibe-oidc\/mistral-large-latest; other valid choices: vibe-oidc\/mistral-large-4#max/u)
  })

  it("proposes the most similar model of the same provider for an unknown model", () => {
    const [issue] = analyzeFusionModels(models, { decider: "vibe-oidc/mistral-large-5#max" })

    assert.equal(issue?.problem, "model-unavailable")
    // "#max" is kept only for candidates that declare a max variant.
    assert.equal(issue?.fallback, "vibe-oidc/mistral-large-4#max")
    assert.deepEqual(issue?.alternatives, ["vibe-oidc/mistral-large-2512", "vibe-oidc/mistral-large-latest", "vibe-oidc/zai-glm-5-3#max"])
    assert.match(describeFusionModelIssue(issue!), /Fusion arbiter .* does not list this model for provider vibe-oidc.* Fix: \/ultracode-fusion-models --decider vibe-oidc\/mistral-large-4#max\./u)
  })

  it("reports a provider that opencode does not offer without inventing a replacement", () => {
    const [issue] = analyzeFusionModels(models, { panelB: "mistral/mistral-large-4#max" })

    assert.equal(issue?.problem, "provider-unavailable")
    assert.equal(issue?.fallback, undefined)
    assert.match(describeFusionModelIssue(issue!), /provider mistral is not available in opencode right now .*restart.*No valid replacement/u)
  })
})
