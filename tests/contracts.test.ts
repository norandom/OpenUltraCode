import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  adversarialPolicies,
  completionStatuses,
  findingDispositions,
  findingSeverities,
  gatePolicies,
  verificationResults,
  workflowModes,
  workflowPhases,
  type AcceptanceCriterion,
  type CompletionReport,
  type DegradationNotice,
  type Finding,
  type PersistedWorkflowState,
  type VerificationEvidence,
  type WorkflowState
} from "../src/index.js"

describe("shared workflow contracts", () => {
  it("exports canonical runtime values for workflow policies and states", () => {
    assert.deepEqual(workflowModes, ["build", "debug", "spec-audit", "adversarial-research", "verify"])
    assert.deepEqual(workflowPhases, [
      "idle",
      "intake",
      "planning",
      "execution",
      "research",
      "adversarial-review",
      "reconciliation",
      "verification",
      "remediation",
      "completed",
      "blocked"
    ])
    assert.deepEqual(gatePolicies, ["strict", "advisory", "disabled"])
    assert.deepEqual(adversarialPolicies, ["required", "recommended", "disabled"])
    assert.deepEqual(findingSeverities, ["high", "medium", "low"])
    assert.deepEqual(findingDispositions, ["accepted", "rejected", "clarification-needed", "deferred"])
    assert.deepEqual(verificationResults, ["pass", "fail", "not-run", "blocked"])
    assert.deepEqual(completionStatuses, ["verified", "partial", "blocked", "failed", "research-only"])
  })

  it("allows runtime modules and tests to share one precise workflow state shape", () => {
    const criterion = {
      id: "AC-1",
      text: "Final report maps evidence to acceptance criteria.",
      source: "spec",
      status: "verified"
    } satisfies AcceptanceCriterion

    const finding = {
      id: "F-1",
      severity: "medium",
      confidence: "high",
      title: "Missing verification mapping",
      evidence: ["Completion report omitted criterion IDs."],
      impact: "The workflow could claim success without proving the requirement.",
      recommendation: "Record verification evidence against each criterion.",
      disposition: "accepted",
      dispositionReason: "The evidence maps directly to Requirement 8.5."
    } satisfies Finding

    const evidence = {
      id: "VE-1",
      kind: "test",
      result: "pass",
      summary: "Contract test passed.",
      command: "npm test -- tests/contracts.test.ts",
      criteriaIds: [criterion.id]
    } satisfies VerificationEvidence

    const degradation = {
      id: "D-1",
      capability: "role-based execution",
      severity: "notice",
      reason: "Subagents are unavailable in this host.",
      userVisibleMessage: "Continuing in single-session workflow mode.",
      safeNextAction: "Preserve the same phase sequence in the current session.",
      occurredAt: "2026-06-15T17:30:00.000Z"
    } satisfies DegradationNotice

    const completion = {
      status: "partial",
      summary: "Implementation completed with one accepted finding still open.",
      criteria: [criterion],
      unresolvedRisks: ["Accepted finding F-1 remains unresolved."],
      verificationIds: [evidence.id],
      findingIds: [finding.id],
      assumptions: ["Subagent fallback preserved the phase sequence."]
    } satisfies CompletionReport

    const state = {
      schemaVersion: 1,
      sessionId: "session-1",
      mode: "build",
      phase: "verification",
      startedAt: "2026-06-15T17:00:00.000Z",
      updatedAt: "2026-06-15T17:30:00.000Z",
      goal: "Define shared workflow contracts.",
      constraints: ["Do not implement gate logic."],
      assumptions: ["Task 1.1 scaffolding is complete."],
      criteria: [criterion],
      findings: [finding],
      verification: [evidence],
      degradations: [degradation],
      completion
    } satisfies WorkflowState

    const persisted = {
      schemaVersion: state.schemaVersion,
      updatedAt: state.updatedAt,
      state
    } satisfies PersistedWorkflowState

    assert.equal(persisted.state.findings[0]?.dispositionReason, finding.dispositionReason)
    assert.equal(persisted.state.completion?.criteria[0]?.status, "verified")
  })
})
