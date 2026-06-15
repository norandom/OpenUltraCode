import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  createDisabledWorkflowNotice,
  createFailedPhaseNotice,
  createHighEffortLimitationNotice,
  createMultiAgentUnavailableNotice,
  createPermissionDeniedNotice,
  createUnsupportedCapabilityNotice,
  summarizeWorkflowDegradation,
  type DegradationNotice
} from "../src/index.js"

const occurredAt = "2026-06-15T19:00:00.000Z"

describe("degradation reporting", () => {
  it("creates deterministic user-facing notices with safe next actions", () => {
    const notices = [
      createUnsupportedCapabilityNotice({
        capability: "compaction hook",
        reason: "opencode did not expose the hook in this runtime",
        phase: "planning",
        occurredAt
      }),
      createMultiAgentUnavailableNotice({
        reason: "subagent execution is unavailable",
        phase: "execution",
        occurredAt
      }),
      createFailedPhaseNotice({
        phase: "verification",
        reason: "npm test failed",
        occurredAt
      }),
      createPermissionDeniedNotice({
        operation: "write src/index.ts",
        reason: "file edit was denied by opencode permissions",
        phase: "execution",
        occurredAt
      }),
      createHighEffortLimitationNotice({
        reason: "selected provider rejected high-effort controls",
        phase: "planning",
        occurredAt
      }),
      createDisabledWorkflowNotice({
        reason: "OpenUltraCode is disabled in configuration",
        occurredAt
      })
    ]

    assert.deepEqual(
      notices.map((notice) => ({
        id: notice.id,
        capability: notice.capability,
        severity: notice.severity,
        reason: notice.reason,
        safeNextAction: notice.safeNextAction,
        occurredAt: notice.occurredAt,
        phase: notice.phase
      })),
      [
        {
          id: "unsupported-compaction-hook",
          capability: "compaction hook",
          severity: "warning",
          reason: "opencode did not expose the hook in this runtime",
          safeNextAction: "Continue without this capability and use the visible workflow phases to track progress.",
          occurredAt,
          phase: "planning"
        },
        {
          id: "multi-agent-unavailable",
          capability: "role-based multi-agent execution",
          severity: "warning",
          reason: "subagent execution is unavailable",
          safeNextAction:
            "Continue in a single-session workflow using intake, planning, execution, review, reconciliation, and verification phases.",
          occurredAt,
          phase: "execution"
        },
        {
          id: "phase-verification-failed",
          capability: "workflow phase verification",
          severity: "blocked",
          reason: "npm test failed",
          safeNextAction:
            "Stop the workflow at verification, fix or explicitly accept the issue, then rerun the phase before reporting completion.",
          occurredAt,
          phase: "verification"
        },
        {
          id: "permission-denied-write-src-index-ts",
          capability: "permission for write src/index.ts",
          severity: "blocked",
          reason: "file edit was denied by opencode permissions",
          safeNextAction:
            "Respect the permission denial; ask the user to approve write src/index.ts or choose a permitted alternative before retrying.",
          occurredAt,
          phase: "execution"
        },
        {
          id: "high-effort-limitation",
          capability: "high-effort provider controls",
          severity: "warning",
          reason: "selected provider rejected high-effort controls",
          safeNextAction:
            "Continue with normal provider settings and rely on visible planning, review, and verification discipline.",
          occurredAt,
          phase: "planning"
        },
        {
          id: "workflow-disabled",
          capability: "OpenUltraCode workflow mode",
          severity: "notice",
          reason: "OpenUltraCode is disabled in configuration",
          safeNextAction: "Use normal opencode behavior or enable OpenUltraCode before starting a governed workflow.",
          occurredAt,
          phase: undefined
        }
      ]
    )

    for (const notice of notices) {
      assert.notEqual(notice.userVisibleMessage, "")
      assert.doesNotMatch(notice.userVisibleMessage, /hidden reasoning|chain-of-thought|bypass/i)
      assert.doesNotMatch(notice.safeNextAction, /hidden reasoning|chain-of-thought|bypass/i)
    }
  })

  it("classifies workflow state consistently from notices and enabled mode", () => {
    const warningNotice = createHighEffortLimitationNotice({
      reason: "selected provider ignored high-effort controls",
      occurredAt
    })
    const blockedNotice = createPermissionDeniedNotice({
      operation: "run npm test",
      reason: "shell command was denied",
      phase: "verification",
      occurredAt
    })

    assert.deepEqual(summarizeWorkflowDegradation({ enabled: false, notices: [] }), {
      state: "disabled",
      message: "OpenUltraCode is disabled. Normal opencode behavior is unchanged.",
      safeNextAction: "Enable OpenUltraCode before starting a governed workflow.",
      notices: []
    })

    assert.deepEqual(summarizeWorkflowDegradation({ enabled: true, notices: [] }), {
      state: "active",
      message: "OpenUltraCode workflow support is active with no reported degradation.",
      safeNextAction: "Continue the current workflow and collect verification evidence before completion.",
      notices: []
    })

    assert.deepEqual(summarizeWorkflowDegradation({ enabled: true, notices: [warningNotice] }), {
      state: "degraded",
      message: "OpenUltraCode is running with 1 degraded capability: high-effort provider controls.",
      safeNextAction: warningNotice.safeNextAction,
      notices: [warningNotice]
    })

    assert.deepEqual(summarizeWorkflowDegradation({ enabled: true, notices: [warningNotice, blockedNotice] }), {
      state: "blocked",
      message: "OpenUltraCode is blocked by 1 capability: permission for run npm test.",
      safeNextAction: blockedNotice.safeNextAction,
      notices: [warningNotice, blockedNotice]
    })
  })

  it("returns typed DegradationNotice values", () => {
    const notice: DegradationNotice = createUnsupportedCapabilityNotice({
      capability: "status tool",
      reason: "tool hook is unavailable",
      occurredAt
    })

    assert.equal(notice.capability, "status tool")
  })
})
