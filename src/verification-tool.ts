import { evaluateCompletionGate } from "./verification.js"
import type { WorkflowStateStore } from "./state.js"
import type {
  CompletionReport,
  OpenUltraCodeOptions,
  VerificationEvidence,
  VerificationKind,
  VerificationResult,
  WorkflowState
} from "./types.js"
import { verificationKinds, verificationResults } from "./types.js"

export interface RecordVerificationToolResult {
  readonly recorded: boolean
  readonly evidenceId?: string
  readonly reason?: string
}

export interface CompletionReportToolInput {
  readonly researchOnly?: boolean
}

export interface RecordVerificationTool {
  readonly description: string
  readonly execute: (input: unknown) => Promise<RecordVerificationToolResult>
}

export interface RecordBlockedCheckTool {
  readonly description: string
  readonly execute: (input: unknown) => Promise<RecordVerificationToolResult>
}

export interface CompletionReportTool {
  readonly description: string
  readonly execute: (input?: CompletionReportToolInput) => Promise<CompletionReport>
}

export function createRecordVerificationTool(stateStore: WorkflowStateStore): RecordVerificationTool {
  return {
    description: "Record OpenUltraCode verification evidence in project-local workflow state.",
    async execute(input: unknown): Promise<RecordVerificationToolResult> {
      const evidence = readVerificationEvidence(input)
      return appendEvidence(stateStore, evidence)
    }
  }
}

export function createRecordBlockedCheckTool(stateStore: WorkflowStateStore): RecordBlockedCheckTool {
  return {
    description: "Record an OpenUltraCode verification check that could not run.",
    async execute(input: unknown): Promise<RecordVerificationToolResult> {
      const evidence = readBlockedEvidence(input)
      return appendEvidence(stateStore, evidence)
    }
  }
}

export function createCompletionReportTool(
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore
): CompletionReportTool {
  return {
    description: "Produce and persist an OpenUltraCode completion report using the runtime verification gate.",
    async execute(input?: CompletionReportToolInput): Promise<CompletionReport> {
      const loaded = await stateStore.load()
      if (loaded.state === undefined) {
        return evaluateCompletionGate({
          policy: config.verificationGate,
          criteria: [],
          evidence: [],
          researchOnly: input?.researchOnly === true
        })
      }

      const report = evaluateCompletionGate({
        policy: config.verificationGate,
        criteria: loaded.state.criteria,
        evidence: loaded.state.verification,
        assumptions: loaded.state.assumptions,
        findingIds: loaded.state.findings.map((finding) => finding.id),
        researchOnly: input?.researchOnly === true || loaded.state.mode === "adversarial-research" || loaded.state.mode === "spec-audit"
      })
      await stateStore.update(withUpdatedState(loaded.state, { completion: report }))

      return report
    }
  }
}

async function appendEvidence(
  stateStore: WorkflowStateStore,
  evidence: VerificationEvidence
): Promise<RecordVerificationToolResult> {
  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return { recorded: false, reason: "No active OpenUltraCode workflow state was found." }
  }

  await stateStore.update(withUpdatedState(loaded.state, { verification: [...loaded.state.verification, evidence] }))

  return { recorded: true, evidenceId: evidence.id }
}

function withUpdatedState(
  state: WorkflowState,
  changes: Pick<WorkflowState, "verification"> | Pick<WorkflowState, "completion">
): WorkflowState {
  return {
    ...state,
    ...changes,
    updatedAt: new Date().toISOString()
  }
}

function readVerificationEvidence(input: unknown): VerificationEvidence {
  const record = requireRecord(input)
  const result = readVerificationResult(record.result)
  const base = {
    id: readString(record.id, "id"),
    kind: readVerificationKind(record.kind),
    result,
    summary: readString(record.summary, "summary"),
    criteriaIds: readStringArray(record.criteriaIds, "criteriaIds"),
    ...readOptionalString(record.command, "command"),
    ...readOptionalString(record.artifact, "artifact")
  }

  if (result === "pass") {
    return {
      ...base,
      result,
      ...readOptionalString(record.residualRisk, "residualRisk")
    }
  }

  return {
    ...base,
    result,
    reason: readString(record.reason, "reason"),
    residualRisk: readString(record.residualRisk, "residualRisk")
  }
}

function readBlockedEvidence(input: unknown): VerificationEvidence {
  const record = requireRecord(input)

  return {
    id: readString(record.id, "id"),
    kind: readVerificationKind(record.kind),
    result: "blocked",
    summary: readString(record.summary, "summary"),
    criteriaIds: readStringArray(record.criteriaIds, "criteriaIds"),
    reason: readString(record.reason, "reason"),
    residualRisk: readString(record.residualRisk, "residualRisk"),
    ...readOptionalString(record.command, "command"),
    ...readOptionalString(record.artifact, "artifact")
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new TypeError("tool input must be an object")
}

function readString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new TypeError(`${name} must be a non-empty string`)
}

function readOptionalString(value: unknown, name: string): Record<string, string> {
  if (value === undefined) {
    return {}
  }
  if (typeof value === "string" && value.length > 0) {
    return { [name]: value }
  }

  throw new TypeError(`${name} must be a non-empty string when provided`)
}

function readStringArray(value: unknown, name: string): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)) {
    return value
  }

  throw new TypeError(`${name} must be an array of non-empty strings`)
}

function readVerificationKind(value: unknown): VerificationKind {
  if (typeof value === "string" && verificationKinds.includes(value as VerificationKind)) {
    return value as VerificationKind
  }

  throw new TypeError(`kind must be one of: ${verificationKinds.join(", ")}`)
}

function readVerificationResult(value: unknown): VerificationResult {
  if (typeof value === "string" && verificationResults.includes(value as VerificationResult)) {
    return value as VerificationResult
  }

  throw new TypeError(`result must be one of: ${verificationResults.join(", ")}`)
}
