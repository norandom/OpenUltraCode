import {
  createFailedPhaseNotice,
  createPermissionDeniedNotice
} from "./degradation.js"
import type { DegradationNotice, Finding, OpenUltraCodeOptions, VerificationEvidence, WorkflowState } from "./types.js"
import type { WorkflowStateStore } from "./state.js"
import { applyHighEffortRequestBehavior } from "./high-effort.js"
import { configureFusionModels, fusionModelReferencePattern } from "./fusion-config-tool.js"
import { createWorkflowStatusTool } from "./status-tool.js"
import {
  createCompletionReportTool,
  createRecordBlockedCheckTool,
  createRecordVerificationTool
} from "./verification-tool.js"
import type {
  OpenCodePluginContext,
  SessionCompactionEvent,
  SessionPromptEvent,
  ToolDefinition,
  ToolExecuteAfterEvent
} from "./opencode-v2.js"

/**
 * Registers OpenUltraCode on the OpenCode 2 plugin context. Returns a cleanup
 * function that aborts the event subscription when the plugin unloads.
 */
export function registerOpenUltraCode(
  ctx: OpenCodePluginContext,
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore
): () => void {
  if (!config.enabled) {
    return () => {}
  }

  void ctx.session.hook("context", (event) => {
    applyHighEffortRequestBehavior(config.highEffort, event.options)
  })

  void ctx.session.hook("prompt", (event) => {
    announceActivation(event)
  })

  void ctx.session.hook("compaction", async (event) => {
    await injectCompactionContext(stateStore, event)
  })

  void ctx.permission.hook("evaluate", async (event) => {
    if (event.effect !== "deny") {
      return
    }

    const operation = event.resources.length > 0 ? `${event.action} ${event.resources.join(" ")}` : event.action
    await blockFromPermission(
      stateStore,
      operation,
      event.resources,
      event.message ?? "permission was denied by opencode rules"
    )
  })

  void ctx.tool.hook("execute.after", async (event) => {
    await observeToolExecution(stateStore, event)
  })

  void ctx.tool.transform((editor) => {
    editor.add(toToolDefinition("open_ultracode_status", createWorkflowStatusTool(config, stateStore), {
      type: "object",
      properties: {},
      additionalProperties: false
    }))
    editor.add(toToolDefinition("open_ultracode_record_verification", createRecordVerificationTool(stateStore), verificationInputSchema()))
    editor.add(toToolDefinition("open_ultracode_record_blocked_check", createRecordBlockedCheckTool(stateStore), verificationInputSchema()))
    editor.add(toToolDefinition("open_ultracode_completion_report", createCompletionReportTool(config, stateStore), {
      type: "object",
      properties: {
        researchOnly: { type: "boolean", description: "Report research-only status instead of running the completion gate." }
      },
      additionalProperties: false
    }))
    editor.add({
      name: "open_ultracode_configure_fusion",
      description:
        "Read or update the persistent OpenUltraCode fusion panel A, panel B, and decider model IDs. Every updated fusion role is configured for maximum reasoning.",
      input: {
        type: "object",
        properties: {
          panelA: { type: "string", pattern: fusionModelReferencePattern.source, description: "Optional provider/model or provider/model#max reference for fusion panel A." },
          panelB: { type: "string", pattern: fusionModelReferencePattern.source, description: "Optional provider/model or provider/model#max reference for fusion panel B." },
          decider: { type: "string", pattern: fusionModelReferencePattern.source, description: "Optional provider/model or provider/model#max reference for the fusion decider." }
        },
        additionalProperties: false
      },
      execute: async (input: unknown) => ({
        content: JSON.stringify(await configureFusionModels(ctx.location.directory, isRecord(input) ? input : {}), null, 2)
      })
    })
  })

  const controller = new AbortController()
  void observePermissionReplies(ctx, stateStore, controller.signal)

  return () => controller.abort()
}

async function observePermissionReplies(
  ctx: OpenCodePluginContext,
  stateStore: WorkflowStateStore,
  signal: AbortSignal
): Promise<void> {
  for await (const event of ctx.event.subscribe({ types: ["permission.replied"], signal })) {
    if (event.type !== "permission.replied" || event.data.reply !== "reject") {
      continue
    }

    const sessionID = typeof event.data.sessionID === "string" ? event.data.sessionID : "unknown session"
    const requestID = typeof event.data.requestID === "string" ? event.data.requestID : "unknown request"
    let operation = `permission request ${requestID}`
    let reason = "permission was rejected by the user"

    try {
      const request = await ctx.permission.get({ sessionID, requestID })
      const action = request.data.action
      const resources = request.data.resources.join(" ")
      operation = resources.length > 0 ? `${action} ${resources}` : action
      if (typeof request.data.message === "string" && request.data.message.length > 0) {
        reason = request.data.message
      }
    } catch {
      // The pending request may already be gone; record the generic denial.
    }

    await blockFromPermission(stateStore, operation, [], reason)
  }
}

function announceActivation(event: SessionPromptEvent): void {
  const match = /Workflow mode:\s*([a-z-]+)/i.exec(event.prompt.text)
  if (match === null) {
    return
  }

  const rawMode = match[1]
  if (rawMode === undefined) {
    return
  }

  const mode = openUltraCodeCommandModes[rawMode.toLowerCase()]
  if (mode === undefined) {
    return
  }

  // Append the mode marker to the admitted prompt so users and the model see it
  // without needing a provider or TUI hook.
  event.prompt.text = `${event.prompt.text}\n\nOpenUltraCode mode active: ${mode}. The active selected opencode model is preserved; workflow status, degradation notices, and verification gates are available.`
}

const openUltraCodeCommandModes: Readonly<Record<string, string>> = {
  comprehensive: "comprehensive",
  debug: "debug",
  "spec-audit": "spec-audit",
  "adversarial-research": "adversarial-research",
  verify: "verify",
  "ultrathink-fusion": "ultrathink-fusion"
}

async function blockFromPermission(
  stateStore: WorkflowStateStore,
  operation: string,
  _resources: readonly string[],
  reason: string
): Promise<void> {
  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return
  }

  const notice = createPermissionDeniedNotice({
    operation,
    reason,
    phase: loaded.state.phase
  })

  await blockWorkflow(stateStore, loaded.state, notice)
}

async function observeToolExecution(
  stateStore: WorkflowStateStore,
  event: ToolExecuteAfterEvent
): Promise<void> {
  if (event.status !== "error") {
    return
  }

  const loaded = await stateStore.load()
  if (loaded.state === undefined) {
    return
  }

  const notice = createFailedPhaseNotice({
    phase: loaded.state.phase,
    reason: `${event.tool} failed: ${event.error.message}`
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

async function injectCompactionContext(
  stateStore: WorkflowStateStore,
  event: SessionCompactionEvent
): Promise<void> {
  const context = createCompactionContext(await stateStore.load())
  if (context.trim().length === 0) {
    return
  }

  event.messages.push({
    role: "user",
    content: [{ type: "text", text: context.trimEnd() }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

  // Keep compaction context to workflow state only. Model, provider, transcript, and unrelated project data stay out.
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

interface WorkflowTool {
  readonly description: string
  readonly execute: (input: unknown) => Promise<unknown>
}

function toToolDefinition(
  name: string,
  tool: WorkflowTool,
  input: Record<string, unknown>
): ToolDefinition {
  return {
    name,
    description: tool.description,
    input,
    execute: async (rawInput: unknown) => ({
      content: JSON.stringify(await tool.execute(rawInput), null, 2)
    })
  }
}

function verificationInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["test", "build", "lint", "typecheck", "audit", "manual", "artifact"] },
      result: { type: "string", enum: ["pass", "fail", "not-run", "blocked"] },
      summary: { type: "string" },
      criteriaIds: { type: "array", items: { type: "string" } },
      command: { type: "string" },
      artifact: { type: "string" },
      reason: { type: "string" },
      residualRisk: { type: "string" }
    },
    required: ["id", "kind", "summary", "criteriaIds"],
    additionalProperties: false
  }
}
