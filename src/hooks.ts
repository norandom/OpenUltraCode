import type { DegradationNotice, Finding, OpenUltraCodeOptions, VerificationEvidence, WorkflowState } from "./types.js"
import type { WorkflowStateStore } from "./state.js"

export interface OpenCodePluginInput {
  readonly directory: string
}

export interface OpenUltraCodeHooks {
  readonly "experimental.session.compacting"?: () => Promise<string>
  readonly "experimental.compaction.autocontinue"?: () => Promise<string>
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
    "experimental.session.compacting": async () => createCompactionContext(await stateStore.load()),
    "experimental.compaction.autocontinue": async () => createCompactionContext(await stateStore.load())
  }
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
