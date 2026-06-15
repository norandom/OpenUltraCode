import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"

import {
  applyHighEffortRequestBehavior,
  evaluateAdversarialReview,
  evaluateCompletionGate,
  type AcceptanceCriterion,
  type Finding,
  type VerificationEvidence
} from "../src/index.js"

const workflowCommands = [
  "ultracode.md",
  "ultracode-debug.md",
  "ultracode-spec-audit.md",
  "ultracode-research.md",
  "ultracode-verify.md"
] as const

describe("OpenUltraCode end-to-end readiness", () => {
  it("keeps opencode selected-model routing authoritative", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "opencode.json"), "utf8")) as Record<string, unknown>

    assert.deepEqual(config.plugin, ["./.opencode/plugins/open-ultracode.ts"])
    assert.deepEqual(config.skills, { paths: [".opencode/skills"] })
    assert.equal("model" in config, false)
    assert.equal("provider" in config, false)
  })

  it("routes every workflow command through selected-model prompts and fallback behavior", () => {
    for (const command of workflowCommands) {
      const content = readFileSync(join(process.cwd(), ".opencode/commands", command), "utf8")

      assert.match(content, /Workflow mode:/i, `${command} must declare a workflow mode`)
      assert.match(content, /selected model/i, `${command} must preserve the active selected model`)
      assert.match(content, /single-session fallback/i, `${command} must describe single-session fallback`)
      assert.doesNotMatch(content, /^model:/m, `${command} must not pin a model`)
      assert.doesNotMatch(content, /use .*proxy|route requests|replace the selected model/i, `${command} must not route models`)
    }
  })

  it("handles adversarial and strict-gate readiness without false completion", () => {
    const adversarial = evaluateAdversarialReview({
      policy: "required",
      findings: [highConfidenceFinding()]
    })

    assert.equal(adversarial.status, "blocked")
    assert.equal(adversarial.allowsCompletion, false)
    assert.deepEqual(adversarial.blockingFindingIds, ["F-ready"])

    const verification = evaluateCompletionGate({
      policy: "strict",
      criteria: [criterion()],
      evidence: [notRunEvidence()]
    })

    assert.equal(verification.status, "partial")
    assert.match(verification.summary, /not-run checks/i)
    assert(verification.unresolvedRisks.some((risk) => risk.includes("VE-ready was not run")))
  })

  it("degrades high-effort readiness without inventing provider controls", () => {
    const params = { temperature: 0.2 }
    const result = applyHighEffortRequestBehavior(
      { enabled: true, effort: "xhigh", outputTokens: 128000 },
      params
    )

    assert.deepEqual(params, { temperature: 0.2 })
    assert.deepEqual(result.appliedFields, [])
    assert.equal(result.degradation?.id, "high-effort-limitation")
    assert.doesNotMatch(result.degradation?.userVisibleMessage ?? "", /hidden reasoning|chain-of-thought|bypass/i)
    assert.doesNotMatch(result.degradation?.safeNextAction ?? "", /hidden reasoning|chain-of-thought|bypass/i)
  })
})

function criterion(): AcceptanceCriterion {
  return {
    id: "AC-ready",
    text: "Readiness validation has fresh evidence.",
    source: "spec",
    status: "pending",
    requirementId: "8.1"
  }
}

function notRunEvidence(): VerificationEvidence {
  return {
    id: "VE-ready",
    kind: "test",
    result: "not-run",
    summary: "Readiness check was not run.",
    criteriaIds: ["AC-ready"],
    reason: "The validation command was skipped.",
    residualRisk: "Completion cannot be claimed without the readiness check."
  }
}

function highConfidenceFinding(): Finding {
  return {
    id: "F-ready",
    severity: "high",
    confidence: "high",
    title: "Unresolved high-confidence readiness finding",
    evidence: ["The adversarial review found an unresolved completion risk."],
    impact: "The workflow could claim completion without reconciling the finding.",
    recommendation: "Fix, accept, or reject the finding with an explicit rationale.",
    affectedRequirementIds: ["10.4"]
  }
}
