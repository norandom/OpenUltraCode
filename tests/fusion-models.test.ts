import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { analyzeFusionModels, describeFusionModelIssue } from "../src/index.js"
import { absentProviderModel, modelList, models, providers, ref, unlistedModel } from "./fixtures/models.js"

describe("fusion model fallbacks", () => {
  it("accepts models and variants that opencode reports", () => {
    assert.deepEqual(analyzeFusionModels(modelList, {
      panelA: ref(models.noVariants),
      panelB: ref(models.withMax, "max"),
      decider: ref(models.otherFamilyWithMax, "max")
    }), [])
  })

  it("falls back to the same model without the variant, then to similar models that declare it", () => {
    const [issue] = analyzeFusionModels(modelList, { panelA: ref(models.noVariants, "max") })

    assert.deepEqual(issue, {
      role: "panelA",
      reference: ref(models.noVariants, "max"),
      problem: "variant-unavailable",
      variants: [],
      fallback: ref(models.noVariants),
      // Same family first (longest shared prefix), then other models declaring max.
      alternatives: [ref(models.withMax, "max"), ref(models.otherFamilyWithMax, "max")]
    })
    assert.match(describeFusionModelIssue(issue!), new RegExp(`no "max" variant .*declares no variants.*Suggested fallback: ${escape(ref(models.noVariants))}`, "u"))
  })

  it("proposes the most similar model of the same provider for an unknown model", () => {
    const [issue] = analyzeFusionModels(modelList, { decider: `${unlistedModel}#max` })

    assert.equal(issue?.problem, "model-unavailable")
    // Among equally similar models, the one declaring the requested variant wins; "#max" is kept only there.
    assert.equal(issue?.fallback, ref(models.withMax, "max"))
    assert.deepEqual(issue?.alternatives, [ref(models.noVariantsDated), ref(models.noVariants), ref(models.otherFamilyWithMax, "max")])
    assert.match(describeFusionModelIssue(issue!), new RegExp(`Fusion arbiter .* does not list this model for provider ${providers.user}.* Fix: /ultracode-fusion-models --decider ${escape(ref(models.withMax, "max"))}\\.`, "u"))
  })

  it("offers the same model from another configured provider when the provider is unavailable", () => {
    const missing = `${providers.absent}/${models.withMax.id}#max`
    const [issue] = analyzeFusionModels(modelList, { panelB: missing })

    assert.equal(issue?.problem, "provider-unavailable")
    // The user's provider declares max for that model; the other provider does not, so it is offered without a variant.
    assert.equal(issue?.fallback, ref(models.sameModelOtherProvider))
    assert.deepEqual(issue?.alternatives, [ref(models.withMax, "max")])
    assert.match(describeFusionModelIssue(issue!), new RegExp(`provider ${providers.absent} is not available in opencode right now .*Suggested fallback`, "u"))
  })

  it("reports an unavailable provider without inventing a replacement when no provider offers the model", () => {
    const [issue] = analyzeFusionModels(modelList, { panelB: absentProviderModel })

    assert.equal(issue?.problem, "provider-unavailable")
    assert.equal(issue?.fallback, undefined)
    assert.match(describeFusionModelIssue(issue!), /No valid replacement/u)
  })
})

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")
}
