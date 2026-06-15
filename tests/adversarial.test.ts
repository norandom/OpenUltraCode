import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { evaluateAdversarialReview, type Finding } from "../src/index.js"

describe("adversarial finding reconciliation", () => {
  it("blocks required policy completion for high-confidence unresolved findings", () => {
    const report = evaluateAdversarialReview({
      policy: "required",
      findings: [unresolvedFinding("F-1")]
    })

    assert.equal(report.status, "blocked")
    assert.equal(report.allowsCompletion, false)
    assert.deepEqual(report.blockingFindingIds, ["F-1"])
    assert.deepEqual(report.warningFindingIds, [])
    assert(report.unresolvedRisks.some((risk) => risk.includes("F-1 remains unresolved")))
    assert.match(report.summary, /required adversarial review policy/i)
  })

  it("blocks required policy completion for high-severity findings with medium confidence", () => {
    const report = evaluateAdversarialReview({
      policy: "required",
      findings: [unresolvedFinding("F-6", "high", "medium")]
    })

    assert.equal(report.status, "blocked")
    assert.equal(report.allowsCompletion, false)
    assert.deepEqual(report.blockingFindingIds, ["F-6"])
    assert.deepEqual(report.warningFindingIds, [])
  })

  it("blocks required policy completion for medium-severity findings with low confidence", () => {
    const report = evaluateAdversarialReview({
      policy: "required",
      findings: [unresolvedFinding("F-7", "medium", "low")]
    })

    assert.equal(report.status, "blocked")
    assert.equal(report.allowsCompletion, false)
    assert.deepEqual(report.blockingFindingIds, ["F-7"])
    assert.deepEqual(report.warningFindingIds, [])
  })

  it("warns without verifying completion under recommended policy", () => {
    const report = evaluateAdversarialReview({
      policy: "recommended",
      findings: [unresolvedFinding("F-1")]
    })

    assert.equal(report.status, "partial")
    assert.equal(report.allowsCompletion, true)
    assert.deepEqual(report.blockingFindingIds, [])
    assert.deepEqual(report.warningFindingIds, ["F-1"])
    assert.match(report.summary, /recommended adversarial review policy/i)
    assert.match(report.summary, /warnings/i)
    assert.notEqual(report.status, "verified")
  })

  it("warns under recommended policy for medium-severity findings with medium confidence", () => {
    const report = evaluateAdversarialReview({
      policy: "recommended",
      findings: [unresolvedFinding("F-8", "medium", "medium")]
    })

    assert.equal(report.status, "partial")
    assert.equal(report.allowsCompletion, true)
    assert.deepEqual(report.blockingFindingIds, [])
    assert.deepEqual(report.warningFindingIds, ["F-8"])
  })

  it("reports disabled adversarial review as research-only without claiming review passed", () => {
    const report = evaluateAdversarialReview({
      policy: "disabled",
      findings: [unresolvedFinding("F-1")]
    })

    assert.equal(report.status, "research-only")
    assert.equal(report.allowsCompletion, true)
    assert.deepEqual(report.blockingFindingIds, [])
    assert.deepEqual(report.warningFindingIds, [])
    assert.match(report.summary, /disabled/i)
    assert.match(report.summary, /no adversarial review pass was claimed/i)
    assert(report.unresolvedRisks.some((risk) => risk.includes("Adversarial review is disabled.")))
  })

  it("requires rejected findings to include explicit evidence-based rationale", () => {
    const rejectedWithoutReason = {
      ...unresolvedFinding("F-2"),
      disposition: "rejected",
      dispositionReason: "   "
    } as unknown as Finding

    const report = evaluateAdversarialReview({
      policy: "required",
      findings: [rejectedWithoutReason]
    })

    assert.equal(report.status, "blocked")
    assert.equal(report.allowsCompletion, false)
    assert.deepEqual(report.invalidFindingIds, ["F-2"])
    assert(report.unresolvedRisks.some((risk) => risk.includes("F-2 was rejected without an explicit rationale.")))
  })

  it("allows required policy completion when high-confidence findings are reconciled", () => {
    const report = evaluateAdversarialReview({
      policy: "required",
      findings: [
        {
          ...unresolvedFinding("F-3"),
          disposition: "rejected",
          dispositionReason: "The cited behavior is covered by VE-1 and Requirement 4.5 does not apply."
        }
      ]
    })

    assert.equal(report.status, "verified")
    assert.equal(report.allowsCompletion, true)
    assert.deepEqual(report.blockingFindingIds, [])
    assert.deepEqual(report.invalidFindingIds, [])
    assert.deepEqual(report.unresolvedRisks, [])
    assert.deepEqual(report.reconciledFindingIds, ["F-3"])
  })
})

function unresolvedFinding(
  id: string,
  severity: Finding["severity"] = "high",
  confidence: Finding["confidence"] = "high"
): Finding {
  return {
    id,
    severity,
    confidence,
    title: "Missing reconciliation",
    evidence: ["The adversarial review identified a requirement gap."],
    impact: "The workflow could claim completion with an unresolved requirement risk.",
    recommendation: "Reconcile or fix the finding before completion.",
    affectedRequirementIds: ["4.4", "5.5"]
  }
}
