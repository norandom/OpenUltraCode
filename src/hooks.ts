import type { DegradationNotice, Finding, OpenUltraCodeOptions, VerificationEvidence, WorkflowState } from "./types.js"
import type { WorkflowStateStore } from "./state.js"
import { applyHighEffortRequestBehavior, type ChatParams } from "./high-effort.js"
import { createWorkflowStatusTool, type WorkflowStatusTool } from "./status-tool.js"
import {
  createCompletionReportTool,
  createRecordBlockedCheckTool,
  createRecordVerificationTool,
  type CompletionReportTool,
  type RecordBlockedCheckTool,
  type RecordVerificationTool
} from "./verification-tool.js"

export interface OpenCodePluginInput {
  readonly directory: string
}

export interface OpenUltraCodeHooks {
  readonly "chat.params"?: (input: unknown, output: ChatParams) => Promise<void>
  readonly "experimental.session.compacting"?: () => Promise<string>
  readonly "experimental.compaction.autocontinue"?: () => Promise<string>
  readonly tool?: OpenUltraCodeTools
}

export interface OpenUltraCodeTools {
  readonly open_ultracode_status: WorkflowStatusTool
  readonly open_ultracode_record_verification: RecordVerificationTool
  readonly open_ultracode_record_blocked_check: RecordBlockedCheckTool
  readonly open_ultracode_completion_report: CompletionReportTool
}

export function createOpenUltraCodeHooks(
  _input: OpenCodePluginInput,
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore
): OpenUltraCodeHooks {
  if (!config.enabled) {
    return {}
  }

  return {
    "chat.params": async (_input, output) => applyHighEffortHints(config, stateStore, output),
    "experimental.session.compacting": async () => createCompactionContext(await stateStore.load()),
    "experimental.compaction.autocontinue": async () => createCompactionContext(await stateStore.load()),
    tool: {
      open_ultracode_status: createWorkflowStatusTool(config, stateStore),
      open_ultracode_record_verification: createRecordVerificationTool(stateStore),
      open_ultracode_record_blocked_check: createRecordBlockedCheckTool(stateStore),
      open_ultracode_completion_report: createCompletionReportTool(config, stateStore)
    }
  }
}

async function applyHighEffortHints(
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore,
  output: ChatParams
): Promise<void> {
  const result = applyHighEffortRequestBehavior(config.highEffort, output)
  if (result.degradation === undefined || !config.notices.showDegradation) {
    return
  }

  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return
  }

  await stateStore.update({
    ...loaded.state,
    updatedAt: result.degradation.occurredAt,
    degradations: replaceDegradation(loaded.state.degradations, result.degradation)
  })
}

function replaceDegradation(
  degradations: readonly DegradationNotice[],
  degradation: DegradationNotice
): readonly DegradationNotice[] {
  return [...degradations.filter((existing) => existing.id !== degradation.id), degradation]
}

interface WorkflowStateLoadSnapshot {
  readonly state: WorkflowState | undefined
  readonly degradations: readonly DegradationNotice[]
}

function createCompactionContext(loaded: WorkflowStateLoadSnapshot): string {
  const degradations = [...(loaded.state?.degradations ?? []), ...loaded.degradations]

  if (loaded.state === undefined && degradations.length === 0) {
    return ""
  }

  const lines = ["OpenUltraCode workflow continuity"]

  if (loaded.state !== undefined) {
    appendStateSummary(lines, loaded.state)
  }

  appendDegradationSummary(lines, degradations)

  return `${lines.join("\n")}\n`
}

function appendStateSummary(lines: string[], state: WorkflowState): void {
  lines.push(`Mode: ${state.mode}`)
  lines.push(`Phase: ${state.phase}`)

  if (state.goal !== undefined) {
    lines.push(`Goal: ${state.goal}`)
  }

  appendList(lines, "Constraints", state.constraints)
  appendList(lines, "Assumptions", state.assumptions)
  appendList(lines, "Open findings", state.findings.filter(isOpenFinding).map(formatFinding))
  appendList(lines, "Verification", state.verification.map(formatVerificationEvidence))

  if (state.completion !== undefined) {
    lines.push(`Completion: ${state.completion.status} - ${state.completion.summary}`)
    appendList(lines, "Unresolved risks", state.completion.unresolvedRisks)
  }
}

function appendDegradationSummary(lines: string[], degradations: readonly DegradationNotice[]): void {
  appendList(lines, "Degradation notices", degradations.map(formatDegradationNotice))
}

function appendList(lines: string[], title: string, values: readonly string[]): void {
  if (values.length === 0) {
    return
  }

  lines.push(`${title}:`)
  for (const value of values) {
    lines.push(`- ${value}`)
  }
}

function isOpenFinding(finding: Finding): boolean {
  return finding.disposition !== "accepted" && finding.disposition !== "rejected"
}

function formatFinding(finding: Finding): string {
  const disposition = finding.disposition === undefined ? "open" : finding.disposition

  return `${finding.id} [${finding.severity}/${finding.confidence}] ${sentence(finding.title)} Status: ${sentence(disposition)} Impact: ${sentence(finding.impact)} Recommendation: ${sentence(finding.recommendation)} Evidence: ${finding.evidence.map(sentence).join(" ")}`
}

function formatVerificationEvidence(evidence: VerificationEvidence): string {
  const reason = evidence.result === "pass" ? "" : ` Reason: ${sentence(evidence.reason)} Residual risk: ${sentence(evidence.residualRisk)}`
  const criteria = evidence.criteriaIds.length === 0 ? "" : ` Criteria: ${evidence.criteriaIds.join(", ")}.`

  return `${evidence.id} [${evidence.kind}:${evidence.result}] ${sentence(evidence.summary)}${reason}${criteria}`
}

function formatDegradationNotice(notice: DegradationNotice): string {
  return `${notice.id} [${notice.severity}] ${notice.capability}: ${sentence(notice.reason)} ${sentence(notice.userVisibleMessage)} Safe next action: ${sentence(notice.safeNextAction)}`
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`
}
