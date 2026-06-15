import type { DegradationNotice, DegradationSeverity, WorkflowPhase } from "./types.js"

export type WorkflowRuntimeState = "active" | "degraded" | "blocked" | "disabled"

interface NoticeContext {
  readonly reason: string
  readonly occurredAt?: string
  readonly phase?: WorkflowPhase
}

export interface UnsupportedCapabilityNoticeInput extends NoticeContext {
  readonly capability: string
}

export type MultiAgentUnavailableNoticeInput = NoticeContext

export interface FailedPhaseNoticeInput extends NoticeContext {
  readonly phase: WorkflowPhase
}

export interface PermissionDeniedNoticeInput extends NoticeContext {
  readonly operation: string
}

export type HighEffortLimitationNoticeInput = NoticeContext

export interface DisabledWorkflowNoticeInput {
  readonly reason: string
  readonly occurredAt?: string
}

export interface WorkflowDegradationSummaryInput {
  readonly enabled: boolean
  readonly notices: readonly DegradationNotice[]
}

export interface WorkflowDegradationSummary {
  readonly state: WorkflowRuntimeState
  readonly message: string
  readonly safeNextAction: string
  readonly notices: readonly DegradationNotice[]
}

export function createUnsupportedCapabilityNotice(input: UnsupportedCapabilityNoticeInput): DegradationNotice {
  return createNotice({
    id: `unsupported-${slugify(input.capability)}`,
    capability: input.capability,
    severity: "warning",
    reason: input.reason,
    userVisibleMessage: `OpenUltraCode cannot use ${input.capability}: ${input.reason}.`,
    safeNextAction: "Continue without this capability and use the visible workflow phases to track progress.",
    occurredAt: input.occurredAt,
    phase: input.phase
  })
}

export function createMultiAgentUnavailableNotice(input: MultiAgentUnavailableNoticeInput): DegradationNotice {
  return createNotice({
    id: "multi-agent-unavailable",
    capability: "role-based multi-agent execution",
    severity: "warning",
    reason: input.reason,
    userVisibleMessage:
      "Role-based multi-agent execution is unavailable; OpenUltraCode will use a single-session fallback with the same phase structure.",
    safeNextAction:
      "Continue in a single-session workflow using intake, planning, execution, review, reconciliation, and verification phases.",
    occurredAt: input.occurredAt,
    phase: input.phase
  })
}

export function createFailedPhaseNotice(input: FailedPhaseNoticeInput): DegradationNotice {
  return createNotice({
    id: `phase-${input.phase}-failed`,
    capability: `workflow phase ${input.phase}`,
    severity: "blocked",
    reason: input.reason,
    userVisibleMessage: `The ${input.phase} phase failed: ${input.reason}.`,
    safeNextAction: `Stop the workflow at ${input.phase}, fix or explicitly accept the issue, then rerun the phase before reporting completion.`,
    occurredAt: input.occurredAt,
    phase: input.phase
  })
}

export function createPermissionDeniedNotice(input: PermissionDeniedNoticeInput): DegradationNotice {
  return createNotice({
    id: `permission-denied-${slugify(input.operation)}`,
    capability: `permission for ${input.operation}`,
    severity: "blocked",
    reason: input.reason,
    userVisibleMessage: `OpenUltraCode cannot perform ${input.operation}: ${input.reason}.`,
    safeNextAction: `Respect the permission denial; ask the user to approve ${input.operation} or choose a permitted alternative before retrying.`,
    occurredAt: input.occurredAt,
    phase: input.phase
  })
}

export function createHighEffortLimitationNotice(input: HighEffortLimitationNoticeInput): DegradationNotice {
  return createNotice({
    id: "high-effort-limitation",
    capability: "high-effort provider controls",
    severity: "warning",
    reason: input.reason,
    userVisibleMessage: `High-effort provider controls are unavailable: ${input.reason}.`,
    safeNextAction: "Continue with normal provider settings and rely on visible planning, review, and verification discipline.",
    occurredAt: input.occurredAt,
    phase: input.phase
  })
}

export function createDisabledWorkflowNotice(input: DisabledWorkflowNoticeInput): DegradationNotice {
  return createNotice({
    id: "workflow-disabled",
    capability: "OpenUltraCode workflow mode",
    severity: "notice",
    reason: input.reason,
    userVisibleMessage: `OpenUltraCode workflow mode is disabled: ${input.reason}.`,
    safeNextAction: "Use normal opencode behavior or enable OpenUltraCode before starting a governed workflow.",
    occurredAt: input.occurredAt
  })
}

export function summarizeWorkflowDegradation(input: WorkflowDegradationSummaryInput): WorkflowDegradationSummary {
  if (!input.enabled) {
    return {
      state: "disabled",
      message: "OpenUltraCode is disabled. Normal opencode behavior is unchanged.",
      safeNextAction: "Enable OpenUltraCode before starting a governed workflow.",
      notices: input.notices
    }
  }

  const blockedNotices = input.notices.filter((notice) => notice.severity === "blocked")
  if (blockedNotices.length > 0) {
    return {
      state: "blocked",
      message: `OpenUltraCode is blocked by ${formatCapabilityList(blockedNotices)}.`,
      safeNextAction: blockedNotices[0]?.safeNextAction ?? "Resolve the blocked capability before continuing.",
      notices: input.notices
    }
  }

  const degradedNotices = input.notices.filter((notice) => notice.severity === "warning")
  if (degradedNotices.length > 0) {
    return {
      state: "degraded",
      message: `OpenUltraCode is running with ${formatCapabilityList(degradedNotices, "degraded ")}.`,
      safeNextAction: degradedNotices[0]?.safeNextAction ?? "Continue with visible workflow checks.",
      notices: input.notices
    }
  }

  return {
    state: "active",
    message: "OpenUltraCode workflow support is active with no reported degradation.",
    safeNextAction: "Continue the current workflow and collect verification evidence before completion.",
    notices: input.notices
  }
}

interface CreateNoticeInput {
  readonly id: string
  readonly capability: string
  readonly severity: DegradationSeverity
  readonly reason: string
  readonly userVisibleMessage: string
  readonly safeNextAction: string
  readonly occurredAt?: string | undefined
  readonly phase?: WorkflowPhase | undefined
}

function createNotice(input: CreateNoticeInput): DegradationNotice {
  return {
    id: input.id,
    capability: input.capability,
    severity: input.severity,
    reason: input.reason,
    userVisibleMessage: input.userVisibleMessage,
    safeNextAction: input.safeNextAction,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.phase === undefined ? {} : { phase: input.phase })
  }
}

function formatCapabilityList(notices: readonly DegradationNotice[], nounPrefix = ""): string {
  const count = notices.length
  const noun = count === 1 ? `${nounPrefix}capability` : `${nounPrefix}capabilities`
  const capabilities = notices.map((notice) => notice.capability).join(", ")

  return `${count} ${noun}: ${capabilities}`
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug.length === 0 ? "unknown" : slug
}
