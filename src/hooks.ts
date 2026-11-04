import {
  createFailedPhaseNotice,
  createPermissionDeniedNotice,
  createToolErrorNotice,
  createUnsupportedCapabilityNotice
} from "./degradation.js"
import type { DegradationNotice, Finding, OpenUltraCodeOptions, VerificationEvidence, WorkflowState } from "./types.js"
import type { WorkflowStateStore } from "./state.js"
import { applyHighEffortRequestBehavior, type ModelLimits } from "./high-effort.js"
import { configureFusionModels, fusionModelReferencePattern } from "./fusion-config-tool.js"
import { createWorkflowStatusTool } from "./status-tool.js"
import {
  createCompletionReportTool,
  createRecordBlockedCheckTool,
  createRecordVerificationTool
} from "./verification-tool.js"
import { createRecordIntakeTool, readWorkflowCommand, recordIntakeInputSchema, startWorkflow } from "./workflow.js"
import { analyzeFusionModels, describeFusionModelIssue, fusionRoleLabel, type FusionModelIssue } from "./fusion-models.js"
import type {
  ModelInfoSummary,
  ModelRef,
  OpenCodePluginContext,
  SessionCompactionEvent,
  SessionPromptEvent,
  ToolDefinition,
  ToolExecuteAfterEvent,
  ToolExecutionContext
} from "./opencode-v2.js"

export const fusionPermissionAction = "open_ultracode_configure_fusion"
const activationMarker = "OpenUltraCode mode active:"
const continuityHeading = "OpenUltraCode workflow continuity"

// OpenCode can load the same plugin more than once in one process (a global entry plus a
// project entry). Hooks must run once per project, or prompts and compactions get duplicated.
const activeProjects: Set<string> = ((globalThis as Record<symbol, unknown>)[Symbol.for("open-ultracode.active-projects")] ??= new Set<string>()) as Set<string>

/**
 * Registers OpenUltraCode on the OpenCode 2 plugin context and returns a cleanup function.
 * Every registration is awaited so failures surface when the plugin loads, and every hook
 * callback is guarded: a plugin bug is logged instead of failing the user's prompt, tool
 * call, permission check, or compaction.
 */
export async function registerOpenUltraCode(
  ctx: OpenCodePluginContext,
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore,
  projectDirectory: string
): Promise<() => void> {
  if (!config.enabled) {
    return () => {}
  }
  if (activeProjects.has(projectDirectory)) {
    console.warn(`OpenUltraCode: already active for ${projectDirectory}; skipping a duplicate plugin entry.`)
    return () => {}
  }
  activeProjects.add(projectDirectory)

  const controller = new AbortController()
  const catalog = createModelCatalog(ctx)
  const registrations = await Promise.all([
    ctx.session.hook("context", guarded("context hook", async (event) => {
      applyHighEffortRequestBehavior(config.highEffort, event.options, await modelLimits(catalog, event.model))
    })),
    ctx.session.hook("prompt", guarded("prompt hook", async (event: SessionPromptEvent) => {
      await activateWorkflow(stateStore, event)
      await checkFusionModels(catalog, stateStore, projectDirectory, event)
    })),
    ctx.session.hook("compaction", guarded("compaction hook", async (event) => {
      await injectCompactionContext(stateStore, event)
    })),
    ctx.permission.hook("evaluate", guarded("permission hook", async (event) => {
      // Only denials of real tool calls block the workflow; rules evaluated while building an
      // agent's tool list (for example fusion agents denying the configure tool) do not.
      if (event.effect !== "deny" || (event.source !== undefined && event.source.type !== "tool")) {
        return
      }
      const operation = event.resources.length > 0 ? `${event.action} ${event.resources.join(" ")}` : event.action
      await blockFromPermission(stateStore, operation, event.message ?? "permission was denied by opencode rules")
    })),
    ctx.tool.hook("execute.after", guarded("tool hook", async (event) => {
      await observeToolExecution(stateStore, event)
    })),
    ctx.tool.transform((editor) => {
      for (const tool of createTools(ctx, catalog, config, stateStore, projectDirectory)) editor.add(tool)
    })
  ])

  void observePermissionReplies(ctx, stateStore, controller.signal).catch((error: unknown) => {
    if (!controller.signal.aborted) logFailure("permission reply listener", error)
  })

  return () => {
    controller.abort()
    activeProjects.delete(projectDirectory)
    for (const registration of registrations) void registration.dispose().catch(() => {})
  }
}

const modelListTtlMs = 60_000

export interface ModelCatalog {
  /** All models opencode currently offers; undefined when the list is unavailable. */
  readonly list: () => Promise<readonly ModelInfoSummary[] | undefined>
  /** The model's entry in opencode's model list; undefined when unknown or the list is unavailable. */
  readonly find: (providerID: string, modelID: string) => Promise<ModelInfoSummary | undefined>
}

/** opencode's model list (`ctx.model.list()`), cached for a minute and shared by all hooks and tools. */
export function createModelCatalog(ctx: OpenCodePluginContext): ModelCatalog {
  let cache: { readonly models: readonly ModelInfoSummary[]; readonly loadedAt: number } | undefined
  const list = async () => {
    try {
      if (cache === undefined || Date.now() - cache.loadedAt > modelListTtlMs) {
        cache = { models: (await ctx.model.list()).data, loadedAt: Date.now() }
      }
      return cache.models
    } catch (error) {
      logFailure("model lookup", error)
      return undefined
    }
  }
  return {
    list,
    async find(providerID, modelID) {
      return (await list())?.find((entry) => entry.providerID === providerID && (entry.id === modelID || entry.modelID === modelID))
    }
  }
}

/** Checks fusion references against opencode's live model list; nothing is judged while it is unavailable. */
async function fusionModelIssues(catalog: ModelCatalog, references: Readonly<Record<string, string>>): Promise<FusionModelIssue[]> {
  const models = await catalog.list()
  return models === undefined ? [] : analyzeFusionModels(models, references)
}

/** Output limit and declared variants of the selected model; empty when opencode does not list it. */
async function modelLimits(catalog: ModelCatalog, model: ModelRef | undefined): Promise<ModelLimits> {
  const info = model === undefined ? undefined : await catalog.find(model.providerID, model.id)
  if (info === undefined) return {}
  return {
    ...(info.limit?.output === undefined ? {} : { outputTokens: info.limit.output }),
    variants: (info.variants ?? []).map((variant) => variant.id)
  }
}

function guarded<T>(label: string, callback: (event: T) => void | Promise<void>): (event: T) => Promise<void> {
  return async (event) => {
    try {
      await callback(event)
    } catch (error) {
      logFailure(label, error)
    }
  }
}

function logFailure(label: string, error: unknown): void {
  console.error(`OpenUltraCode: ${label} failed: ${error instanceof Error ? error.message : String(error)}`)
}

function createTools(
  ctx: OpenCodePluginContext,
  catalog: ModelCatalog,
  config: OpenUltraCodeOptions,
  stateStore: WorkflowStateStore,
  projectDirectory: string
): ToolDefinition[] {
  return [
    toToolDefinition("open_ultracode_status", createWorkflowStatusTool(config, stateStore), {
      type: "object",
      properties: {},
      additionalProperties: false
    }),
    toToolDefinition("open_ultracode_record_intake", createRecordIntakeTool(stateStore), recordIntakeInputSchema()),
    toToolDefinition("open_ultracode_list_models", createListModelsTool(catalog), {
      type: "object",
      properties: {
        provider: { type: "string", description: "Only list this provider's models, for example the provider of a failing fusion role." }
      },
      additionalProperties: false
    }),
    toToolDefinition("open_ultracode_record_verification", createRecordVerificationTool(stateStore), verificationInputSchema()),
    toToolDefinition("open_ultracode_record_blocked_check", createRecordBlockedCheckTool(stateStore), blockedCheckInputSchema()),
    toToolDefinition("open_ultracode_completion_report", createCompletionReportTool(config, stateStore), {
      type: "object",
      properties: {
        researchOnly: { type: "boolean", description: "Report research-only status instead of running the completion gate." }
      },
      additionalProperties: false
    }),
    {
      name: fusionPermissionAction,
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
      execute: async (input: unknown, context: ToolExecutionContext) => {
        const request = isRecord(input) ? input : {}
        // Reading the configuration is free; rewriting agent files needs the user's approval.
        // assert() prompts according to the session's rules and rejects when denied; the
        // rejection must propagate so OpenCode ends the step instead of reporting success.
        if (["panelA", "panelB", "decider"].some((key) => request[key] !== undefined)) {
          // Refuse a variant the model does not declare before asking or writing anything.
          const requested = Object.fromEntries(
            ["panelA", "panelB", "decider"].flatMap((key) => (typeof request[key] === "string" ? [[key, request[key]]] : []))
          ) as Record<string, string>
          const issues = await fusionModelIssues(catalog, requested)
          if (issues.length > 0) throw new TypeError(issues.map(describeFusionModelIssue).join(" "))
          await ctx.permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            action: fusionPermissionAction,
            resources: [projectDirectory],
            source: { type: "tool", messageID: context.messageID, id: context.id }
          })
        }
        return { content: JSON.stringify(await configureFusionModels(projectDirectory, request), null, 2) }
      }
    }
  ]
}

/**
 * Read-only view of opencode's model list for choosing a valid fusion fallback: every model
 * reference the fusion tool accepts, with the variants opencode reports for it.
 */
function createListModelsTool(catalog: ModelCatalog) {
  return {
    description:
      "List the models opencode currently offers, grouped by provider, as fusion references (provider/model, plus provider/model#max where the model declares a max variant). Use it to pick a valid fallback when a fusion role's model or variant is unavailable.",
    async execute(input: unknown) {
      const provider = isRecord(input) && typeof input.provider === "string" ? input.provider : undefined
      const models = await catalog.list()
      if (models === undefined) return { available: false, reason: "opencode's model list is unavailable right now." }
      const providers: Record<string, Array<{ reference: string; variants: string[]; maxReference?: string }>> = {}
      for (const model of models) {
        if (provider !== undefined && model.providerID !== provider) continue
        const variants = (model.variants ?? []).map((variant) => variant.id)
        const reference = `${model.providerID}/${model.id}`
        ;(providers[model.providerID] ??= []).push({ reference, variants, ...(variants.includes("max") ? { maxReference: `${reference}#max` } : {}) })
      }
      return { available: true, providers }
    }
  }
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

    try {
      await recordPermissionRejection(ctx, stateStore, event.data)
    } catch (error) {
      logFailure("permission reply handling", error)
    }
  }
}

async function recordPermissionRejection(
  ctx: OpenCodePluginContext,
  stateStore: WorkflowStateStore,
  data: Record<string, unknown>
): Promise<void> {
  const requestID = typeof data.requestID === "string" ? data.requestID : undefined
  let operation = `permission request ${requestID ?? "unknown"}`
  let reason = "permission was rejected by the user"

  if (typeof data.sessionID === "string" && requestID !== undefined) {
    try {
      const request = await ctx.permission.get({ sessionID: data.sessionID, requestID })
      const resources = request.resources.join(" ")
      operation = resources.length > 0 ? `${request.action} ${resources}` : request.action
      if (typeof request.message === "string" && request.message.length > 0) {
        reason = request.message
      }
    } catch {
      // The request may already be gone once it was answered; record the generic rejection.
    }
  }

  await blockFromPermission(stateStore, operation, reason)
}

/** Starts or continues the workflow for an OpenUltraCode command and marks the prompt once. */
async function activateWorkflow(stateStore: WorkflowStateStore, event: SessionPromptEvent): Promise<void> {
  const command = readWorkflowCommand(event.prompt.text)
  if (command === undefined) {
    return
  }

  await startWorkflow(stateStore, command, event.sessionID)

  if (!event.prompt.text.includes(activationMarker)) {
    // Put the marker into the admitted prompt so users and the model see it without a TUI hook.
    event.prompt.text = `${event.prompt.text}\n\n${activationMarker} ${command.label}. The active selected opencode model is preserved. ` +
      "Record intake with open_ultracode_record_intake, evidence with open_ultracode_record_verification, and finish with open_ultracode_completion_report."
  }
}

const fusionCheckMarker = "OpenUltraCode fusion check:"

/** How the coordinator recovers: propose a valid fallback, let the user decide, then fix it. */
const fusionFallbackInstruction =
  "Before dispatching any affected fusion agent: tell the user about each problem, propose the suggested fallback " +
  "(or another valid model of the same provider from open_ultracode_list_models), and ask the user to confirm it or name another model. " +
  "Wait for the answer. Then call open_ultracode_configure_fusion with the model the user chose (it asks for permission); " +
  "opencode applies the change to the next agent dispatch without a restart, so continue the fusion run afterwards. " +
  "If the user declines, do not dispatch the affected agents; continue with the remaining valid roles only if the user agrees, otherwise stop and report the configuration problem. " +
  "If the user cannot be asked in this session (no question tool, non-interactive run), use the suggested fallback for this run only by passing it as the dispatch's explicit model, " +
  "do not change the fusion configuration, and disclose the fallback and the persistent fix command in the final report."

/**
 * Before a fusion workflow dispatches its panels, checks each fusion agent's provider, model,
 * and variant against opencode's live model list. Problems are shown in the prompt together
 * with a valid fallback from the same provider and instructions for the coordinator to ask
 * the user, and recorded as degradation notices. Nothing is changed without the user.
 */
async function checkFusionModels(
  catalog: ModelCatalog,
  stateStore: WorkflowStateStore,
  projectDirectory: string,
  event: SessionPromptEvent
): Promise<void> {
  const text = event.prompt.text
  if (readWorkflowCommand(text) === undefined || !/ultracode-fusion-(?:panel|arbiter)/u.test(text) || text.includes(fusionCheckMarker)) {
    return
  }

  const configured = await configureFusionModels(projectDirectory, {})
  const issues = await fusionModelIssues(catalog, { ...configured.models })
  if (issues.length === 0) return

  event.prompt.text = `${text}\n\n${fusionCheckMarker} ${issues.map(describeFusionModelIssue).join(" ")} ${fusionFallbackInstruction}`
  await stateStore.mutate((state) => ({
    ...state,
    updatedAt: new Date().toISOString(),
    degradations: issues.reduce(
      (notices, issue) => replaceDegradation(notices, createUnsupportedCapabilityNotice({
        capability: `${fusionRoleLabel(issue.role)} model`,
        reason: describeFusionModelIssue(issue),
        phase: state.phase
      })),
      state.degradations
    )
  }))
}

async function blockFromPermission(
  stateStore: WorkflowStateStore,
  operation: string,
  reason: string
): Promise<void> {
  await stateStore.mutate((state) => blockWorkflow(state, createPermissionDeniedNotice({ operation, reason, phase: state.phase })))
}

async function observeToolExecution(
  stateStore: WorkflowStateStore,
  event: ToolExecuteAfterEvent
): Promise<void> {
  if (event.status !== "error") {
    return
  }

  const reason = `${event.tool} failed: ${event.error.message}`
  // Only failures of the workflow's own gate tools block it. Ordinary tool errors (a failed
  // search, a missing file, an MCP hiccup) are part of normal work and are only noted.
  if (event.tool.startsWith("open_ultracode_")) {
    await stateStore.mutate((state) => blockWorkflow(state, createFailedPhaseNotice({ phase: state.phase, reason })))
    return
  }
  await stateStore.mutate((state) => ({
    ...state,
    updatedAt: new Date().toISOString(),
    degradations: replaceDegradation(state.degradations, createToolErrorNotice({ tool: event.tool, phase: state.phase, reason: event.error.message }))
  }))
}

function blockWorkflow(state: WorkflowState, notice: DegradationNotice): WorkflowState {
  return {
    ...state,
    phase: "blocked",
    updatedAt: notice.occurredAt,
    degradations: replaceDegradation(state.degradations, notice)
  }
}

async function injectCompactionContext(
  stateStore: WorkflowStateStore,
  event: SessionCompactionEvent
): Promise<void> {
  const context = createCompactionContext(await stateStore.load())
  if (context.trim().length === 0 || event.system.some((part) => part.text.startsWith(continuityHeading))) {
    return
  }

  // System parts are plain structs; synthetic messages would have to satisfy the LLM.Message schema.
  event.system.push({ type: "text", text: context.trimEnd() })
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
  const lines = [continuityHeading]

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

const verificationProperties = {
  id: { type: "string" },
  kind: { type: "string", enum: ["test", "build", "lint", "typecheck", "audit", "manual", "artifact"] },
  summary: { type: "string" },
  criteriaIds: { type: "array", items: { type: "string" } },
  command: { type: "string" },
  artifact: { type: "string" },
  reason: { type: "string", description: "Required unless result is pass." },
  residualRisk: { type: "string", description: "Required unless result is pass." }
}

// The required lists match the validators in verification-tool.ts (tests check this).
export function verificationInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      ...verificationProperties,
      result: { type: "string", enum: ["pass", "fail", "not-run", "blocked"] }
    },
    required: ["id", "kind", "result", "summary", "criteriaIds"],
    additionalProperties: false
  }
}

export function blockedCheckInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: verificationProperties,
    required: ["id", "kind", "summary", "criteriaIds", "reason", "residualRisk"],
    additionalProperties: false
  }
}
