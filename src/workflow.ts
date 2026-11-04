import type { WorkflowStateStore } from "./state.js"
import {
  acceptanceCriterionSources,
  workflowPhases,
  type AcceptanceCriterion,
  type AcceptanceCriterionSource,
  type WorkflowMode,
  type WorkflowPhase,
  type WorkflowState
} from "./types.js"

/** `Workflow mode:` values used by the bundled commands, mapped to persisted workflow modes. */
export const commandWorkflowModes: Readonly<Record<string, WorkflowMode>> = {
  comprehensive: "build",
  debug: "debug",
  "spec-audit": "spec-audit",
  "adversarial-research": "adversarial-research",
  verify: "verify",
  // Problem solving without implementation changes completes as research-only.
  ultrathink: "adversarial-research",
  "ultrathink-fusion": "adversarial-research"
}

export interface WorkflowCommand {
  /** The command's own mode label, for example "comprehensive". */
  readonly label: string
  readonly mode: WorkflowMode
  readonly goal?: string
}

/** Recognizes an expanded OpenUltraCode command prompt ("Workflow mode: <label>" on its own line). */
export function readWorkflowCommand(text: string): WorkflowCommand | undefined {
  // Every bundled workflow command starts by loading the skill; a bare "Workflow mode:" line
  // in an ordinary user prompt must not start a workflow.
  if (!text.includes("Use the `open-ultracode` skill")) return undefined
  const label = /^Workflow mode:[ \t]*([a-z-]+)[ \t]*$/imu.exec(text)?.[1]?.toLowerCase()
  const mode = label === undefined ? undefined : commandWorkflowModes[label]
  if (label === undefined || mode === undefined) return undefined

  // The bundled commands put the user's task into the first ```text block.
  const goal = /```text\r?\n([\s\S]*?)\r?\n```/u.exec(text)?.[1]?.trim()
  return { label, mode, ...(goal === undefined || goal === "" || goal === "$ARGUMENTS" ? {} : { goal }) }
}

export function createWorkflowState(input: {
  readonly mode: WorkflowMode
  readonly sessionID: string
  readonly goal?: string
  readonly now?: Date
}): WorkflowState {
  const now = (input.now ?? new Date()).toISOString()
  return {
    schemaVersion: 1,
    sessionId: input.sessionID,
    mode: input.mode,
    phase: "intake",
    startedAt: now,
    updatedAt: now,
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    constraints: [],
    assumptions: [],
    criteria: [],
    findings: [],
    verification: [],
    degradations: []
  }
}

/**
 * Starts a fresh workflow for a new command, but keeps an unfinished workflow of the same
 * session and mode so follow-up prompts continue it instead of discarding evidence.
 */
export async function startWorkflow(
  stateStore: WorkflowStateStore,
  command: WorkflowCommand,
  sessionID: string,
  now = new Date()
): Promise<WorkflowState> {
  const { state } = await stateStore.load()
  if (state !== undefined && state.sessionId === sessionID && state.mode === command.mode && state.phase !== "completed") {
    return state
  }
  const next = createWorkflowState({ mode: command.mode, sessionID, now, ...(command.goal === undefined ? {} : { goal: command.goal }) })
  await stateStore.update(next)
  return next
}

export interface RecordIntakeToolResult {
  readonly recorded: boolean
  readonly reason?: string
  readonly phase?: WorkflowPhase
  readonly criteriaIds?: readonly string[]
}

const settablePhases = workflowPhases.filter((phase) => phase !== "blocked")

export function createRecordIntakeTool(stateStore: WorkflowStateStore) {
  return {
    description:
      "Record the OpenUltraCode intake (goal, constraints, assumptions, acceptance criteria) and move the workflow to its next phase. " +
      "Use it after intake, when criteria change, and to resume a blocked workflow once the blocker is resolved.",
    async execute(input: unknown): Promise<RecordIntakeToolResult> {
      const intake = readIntake(input)
      const next = await stateStore.mutate((state) => ({
        ...state,
        ...(intake.goal === undefined ? {} : { goal: intake.goal }),
        ...(intake.constraints === undefined ? {} : { constraints: intake.constraints }),
        ...(intake.assumptions === undefined ? {} : { assumptions: intake.assumptions }),
        ...(intake.phase === undefined ? {} : { phase: intake.phase }),
        criteria: mergeCriteria(state.criteria, intake.criteria ?? []),
        updatedAt: new Date().toISOString()
      }))
      if (next === undefined) {
        return { recorded: false, reason: "No active OpenUltraCode workflow state was found. Start one with an OpenUltraCode command." }
      }
      return { recorded: true, phase: next.phase, criteriaIds: next.criteria.map((criterion) => criterion.id) }
    }
  }
}

export function recordIntakeInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      goal: { type: "string", description: "The user-observable goal of the workflow." },
      constraints: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      criteria: {
        type: "array",
        description: "Acceptance criteria. Existing criteria with the same id are replaced and reset to pending.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            source: { type: "string", enum: [...acceptanceCriterionSources] }
          },
          required: ["id", "text"],
          additionalProperties: false
        }
      },
      phase: { type: "string", enum: settablePhases, description: "The phase the workflow moves to." }
    },
    additionalProperties: false
  }
}

interface Intake {
  readonly goal?: string
  readonly constraints?: readonly string[]
  readonly assumptions?: readonly string[]
  readonly criteria?: readonly AcceptanceCriterion[]
  readonly phase?: WorkflowPhase
}

function readIntake(input: unknown): Intake {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("tool input must be an object")
  }
  const record = input as Record<string, unknown>
  return {
    ...optional("goal", record.goal, readText),
    ...optional("constraints", record.constraints, readTextList),
    ...optional("assumptions", record.assumptions, readTextList),
    ...optional("criteria", record.criteria, readCriteria),
    ...optional("phase", record.phase, readPhase)
  }
}

function optional<K extends string, T>(key: K, value: unknown, read: (value: unknown, name: string) => T): Partial<Record<K, T>> {
  return value === undefined ? {} : ({ [key]: read(value, key) } as Partial<Record<K, T>>)
}

function readText(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  throw new TypeError(`${name} must be a non-empty string`)
}

function readTextList(value: unknown, name: string): readonly string[] {
  if (Array.isArray(value)) return value.map((item, index) => readText(item, `${name}[${index}]`))
  throw new TypeError(`${name} must be an array of non-empty strings`)
}

function readCriteria(value: unknown, name: string): readonly AcceptanceCriterion[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new TypeError(`${name}[${index}] must be an object`)
    const record = item as Record<string, unknown>
    const source = record.source ?? "user"
    if (typeof source !== "string" || !acceptanceCriterionSources.includes(source as AcceptanceCriterionSource)) {
      throw new TypeError(`${name}[${index}].source must be one of: ${acceptanceCriterionSources.join(", ")}`)
    }
    return {
      id: readText(record.id, `${name}[${index}].id`),
      text: readText(record.text, `${name}[${index}].text`),
      source: source as AcceptanceCriterionSource,
      status: "pending"
    }
  })
}

function readPhase(value: unknown, name: string): WorkflowPhase {
  if (typeof value === "string" && (settablePhases as readonly string[]).includes(value)) return value as WorkflowPhase
  throw new TypeError(`${name} must be one of: ${settablePhases.join(", ")}`)
}

function mergeCriteria(existing: readonly AcceptanceCriterion[], updates: readonly AcceptanceCriterion[]): readonly AcceptanceCriterion[] {
  const byId = new Map(existing.map((criterion) => [criterion.id, criterion]))
  for (const criterion of updates) byId.set(criterion.id, criterion)
  return [...byId.values()]
}
