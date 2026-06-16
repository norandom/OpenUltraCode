import {
  createFailedPhaseNotice,
  createPermissionDeniedNotice
} from "./degradation.js"
import { workflowPhases, type DegradationNotice, type Finding, type OpenUltraCodeOptions, type VerificationEvidence, type WorkflowPhase, type WorkflowState } from "./types.js"
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
  readonly "command.execute.before"?: (input: unknown, output: CommandOutput) => Promise<void>
  readonly "permission.ask"?: (input: unknown, output: Record<string, unknown>) => Promise<void>
  readonly "tool.execute.after"?: (input: unknown, output: Record<string, unknown>) => Promise<void>
  readonly "experimental.session.compacting"?: () => Promise<string>
  readonly "experimental.compaction.autocontinue"?: () => Promise<string>
  readonly tool?: OpenUltraCodeTools
}

export interface CommandOutput {
  readonly parts?: unknown[]
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
    "command.execute.before": async (input, output) => announceActivation(input, output),
    "permission.ask": async (input, output) => observePermissionDecision(stateStore, input, output),
    "tool.execute.after": async (input, output) => observeToolExecution(stateStore, input, output),
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

function announceActivation(input: unknown, output: CommandOutput): void {
  if (!Array.isArray(output.parts)) {
    return
  }

  const command = readString(input, "command")
  const mode = command === undefined ? undefined : openUltraCodeCommandModes[command]
  if (mode === undefined) {
    return
  }

  output.parts.push({
    type: "text",
    text: `OpenUltraCode mode active: ${mode}. The active selected opencode model is preserved; workflow status, degradation notices, and verification gates are available.`
  })
}

const openUltraCodeCommandModes: Readonly<Record<string, string>> = {
  ultracode: "comprehensive",
  "ultracode-debug": "debug",
  "ultracode-spec-audit": "spec-audit",
  "ultracode-research": "adversarial-research",
  "ultracode-verify": "verify"
}

async function observePermissionDecision(
  stateStore: WorkflowStateStore,
  input: unknown,
  output: Record<string, unknown>
): Promise<void> {
  if (!isDeniedPermission(output)) {
    return
  }

  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return
  }

  const operation = readString(input, "operation") ?? readString(output, "operation") ?? "unknown operation"
  const reason = readString(output, "reason") ?? readString(input, "reason") ?? "permission was denied"
  const phase = readWorkflowPhase(input, "phase") ?? loaded.state.phase
  const notice = createPermissionDeniedNotice({ operation, reason, phase })

  await blockWorkflow(stateStore, loaded.state, notice)
}

async function observeToolExecution(
  stateStore: WorkflowStateStore,
  input: unknown,
  output: Record<string, unknown>
): Promise<void> {
  const failureReason = readToolFailureReason(output)
  if (failureReason === undefined) {
    return
  }

  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return
  }

  const tool = readString(input, "tool") ?? readString(input, "toolName") ?? readString(output, "tool") ?? "tool"
  const phase = readWorkflowPhase(input, "phase") ?? readWorkflowPhase(output, "phase") ?? loaded.state.phase
  const notice = createFailedPhaseNotice({
    phase,
    reason: `${tool} failed: ${failureReason}`
  })

  await blockWorkflow(stateStore, loaded.state, notice)
}

async function blockWorkflow(
  stateStore: WorkflowStateStore,
  state: WorkflowState,
  notice: DegradationNotice
): Promise<void> {
  await stateStore.update({
    ...state,
    phase: "blocked",
    updatedAt: notice.occurredAt,
    degradations: replaceDegradation(state.degradations, notice)
  })
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

function isDeniedPermission(output: Record<string, unknown>): boolean {
  const decision = readString(output, "action") ?? readString(output, "status") ?? readString(output, "decision")

  return decision === "deny" || decision === "denied" || decision === "reject" || decision === "rejected"
}

function readToolFailureReason(output: Record<string, unknown>): string | undefined {
  const error = output.error
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string" && error.length > 0) {
    return error
  }

  const status = readString(output, "status") ?? readString(output, "result")
  if (status !== "error" && status !== "failed" && status !== "fail") {
    return undefined
  }

  return readString(output, "reason") ?? readString(output, "message") ?? "tool execution failed"
}

function readString(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const result = value[field]
  return typeof result === "string" && result.length > 0 ? result : undefined
}

function readWorkflowPhase(value: unknown, field: string): WorkflowPhase | undefined {
  const phase = readString(value, field)

  return phase !== undefined && workflowPhases.includes(phase as WorkflowPhase) ? (phase as WorkflowPhase) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
