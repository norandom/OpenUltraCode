import type { CompletionReport, DegradationNotice, Finding, OpenUltraCodeOptions, VerificationEvidence, WorkflowState } from "./types.js"
import type { WorkflowStateStore } from "./state.js"

export interface WorkflowStatusToolResult {
  readonly active: boolean
  readonly mode?: WorkflowState["mode"]
  readonly phase?: WorkflowState["phase"]
  readonly goal?: string
  readonly completion?: CompletionReport
  readonly degradations: readonly string[]
  readonly degradationDetails: readonly WorkflowStatusDegradation[]
  readonly openFindings: readonly string[]
  readonly verification: readonly string[]
}

export interface WorkflowStatusDegradation {
  readonly id: string
  readonly capability: string
  readonly severity: DegradationNotice["severity"]
  readonly reason: string
  readonly safeNextAction: string
  readonly phase?: WorkflowState["phase"]
}

export interface WorkflowStatusTool {
  readonly description: string
  readonly execute: (input: Record<string, never>) => Promise<WorkflowStatusToolResult>
}

export function createWorkflowStatusTool(
  _config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore
): WorkflowStatusTool {
  return {
    description: "Read the current OpenUltraCode workflow status from project-local state.",
    async execute(): Promise<WorkflowStatusToolResult> {
      const loaded = await stateStore.load()
      const degradations = [...(loaded.state?.degradations ?? []), ...loaded.degradations]

      if (loaded.state === undefined) {
        return {
          active: false,
          degradations: degradations.map((notice) => notice.id),
          degradationDetails: degradations.map(formatDegradationDetail),
          openFindings: [],
          verification: []
        }
      }

      return summarizeState(loaded.state, degradations)
    }
  }
}

function summarizeState(state: WorkflowState, degradations: readonly DegradationNotice[]): WorkflowStatusToolResult {
  return {
    active: true,
    mode: state.mode,
    phase: state.phase,
    ...(state.goal === undefined ? {} : { goal: state.goal }),
    ...(state.completion === undefined ? {} : { completion: state.completion }),
    degradations: degradations.map((notice) => notice.id),
    degradationDetails: degradations.map(formatDegradationDetail),
    openFindings: state.findings.filter(isOpenFinding).map((finding) => finding.id),
    verification: state.verification.map(formatVerificationEvidence)
  }
}

function formatDegradationDetail(notice: DegradationNotice): WorkflowStatusDegradation {
  return {
    id: notice.id,
    capability: notice.capability,
    severity: notice.severity,
    reason: notice.reason,
    safeNextAction: notice.safeNextAction,
    ...(notice.phase === undefined ? {} : { phase: notice.phase })
  }
}

function isOpenFinding(finding: Finding): boolean {
  return finding.disposition !== "accepted" && finding.disposition !== "rejected"
}

function formatVerificationEvidence(evidence: VerificationEvidence): string {
  return `${evidence.id}:${evidence.result}`
}
