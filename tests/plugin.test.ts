import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  OpenUltraCodePlugin,
  createWorkflowStateStore,
  type OpenCodePluginContext,
  type SessionCompactionEvent,
  type SessionContextEvent,
  type SessionPromptEvent,
  type ToolDefinition,
  type ToolExecuteAfterEvent,
  type VerificationEvidence,
  type WorkflowState
} from "../src/index.js"

const stateDirectory = ".opencode/open-ultracode/state"
const stateFile = join(stateDirectory, "workflow-state.json")

interface FakeContext extends OpenCodePluginContext {
  readonly sessionHooks: Map<string, (event: never) => unknown>
  readonly permissionHooks: Array<(event: never) => unknown>
  readonly toolHooks: Map<string, (event: never) => unknown>
  readonly toolDefinitions: ToolDefinition[]
  readonly events: Array<{ type: string; data: Record<string, unknown> }>
  readonly emit: (event: { type: string; data: Record<string, unknown> }) => void
  readonly permissionRequests: Map<string, { action: string; resources: readonly string[]; message?: string }>
}

function createFakeContext(directory: string, options: unknown): FakeContext {
  const sessionHooks = new Map<string, (event: never) => unknown>()
  const permissionHooks: Array<(event: never) => unknown> = []
  const toolHooks = new Map<string, (event: never) => unknown>()
  const toolDefinitions: ToolDefinition[] = []
  const events: Array<{ type: string; data: Record<string, unknown> }> = []
  const listeners: Array<(event: { type: string; data: Record<string, unknown> }) => void> = []
  const permissionRequests = new Map<string, { action: string; resources: readonly string[]; message?: string }>()

  const ctx: FakeContext = {
    location: { directory },
    options,
    sessionHooks,
    permissionHooks,
    toolHooks,
    toolDefinitions,
    events,
    permissionRequests,
    emit(event) {
      events.push(event)
      for (const listener of listeners) listener(event)
    },
    session: {
      hook(name: string, callback: (event: never) => unknown) {
        sessionHooks.set(name, callback)
        return Promise.resolve({ dispose: () => Promise.resolve() })
      }
    } as unknown as OpenCodePluginContext["session"],
    permission: {
      hook(_name: string, callback: (event: never) => unknown) {
        permissionHooks.push(callback)
        return Promise.resolve({ dispose: () => Promise.resolve() })
      },
      get(input: { sessionID: string; requestID: string }) {
        const request = permissionRequests.get(input.requestID)
        if (request === undefined) {
          return Promise.reject(new Error("unknown permission request"))
        }
        return Promise.resolve({ data: request })
      }
    } as unknown as OpenCodePluginContext["permission"],
    tool: {
      hook(name: string, callback: (event: never) => unknown) {
        toolHooks.set(name, callback)
        return Promise.resolve({ dispose: () => Promise.resolve() })
      },
      transform(callback: (editor: { add(tool: ToolDefinition): void }) => void) {
        const editor = {
          add(tool: ToolDefinition) {
            toolDefinitions.push(tool)
          }
        }
        callback(editor)
        return Promise.resolve({ dispose: () => Promise.resolve() })
      }
    } as unknown as OpenCodePluginContext["tool"],
    event: {
      subscribe(options?: { types?: string[]; signal?: AbortSignal }) {
        const types = options?.types
        const signal = options?.signal
        const queue: Array<{ type: string; data: Record<string, unknown> }> = []
        const waiters: Array<() => void> = []
        listeners.push((event) => {
          if (types === undefined || types.includes(event.type)) {
            queue.push(event)
            for (const waiter of waiters.splice(0)) waiter()
          }
        })
        return {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              if (signal?.aborted) return
              while (queue.length > 0) {
                const event = queue.shift()
                if (event !== undefined) yield event
              }
              await new Promise<void>((resolve) => {
                waiters.push(resolve)
                signal?.addEventListener("abort", () => resolve(), { once: true })
              })
            }
          }
        }
      }
    } as unknown as OpenCodePluginContext["event"]
  }

  return ctx
}

async function setupPlugin(directory: string, options: unknown): Promise<FakeContext> {
  const ctx = createFakeContext(directory, options)
  await OpenUltraCodePlugin.setup(ctx)
  return ctx
}

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-ultracode-plugin-"))
}

function getSessionHook(ctx: FakeContext, name: string): (event: never) => unknown {
  const hook = ctx.sessionHooks.get(name)
  if (hook === undefined) {
    throw new TypeError(`session hook ${name} is missing`)
  }
  return hook
}

function getToolHook(ctx: FakeContext, name: string): (event: never) => unknown {
  const hook = ctx.toolHooks.get(name)
  if (hook === undefined) {
    throw new TypeError(`tool hook ${name} is missing`)
  }
  return hook
}

function getTool(ctx: FakeContext, name: string): ToolDefinition {
  const tool = ctx.toolDefinitions.find((definition) => definition.name === name)
  if (tool === undefined) {
    throw new TypeError(`tool ${name} is missing`)
  }
  return tool
}

async function executeTool(ctx: FakeContext, name: string, input: unknown): Promise<unknown> {
  const tool = getTool(ctx, name)
  const result = await tool.execute(input, { signal: new AbortController().signal })
  if (typeof result.content !== "string") {
    throw new TypeError(`tool ${name} did not return text content`)
  }
  return JSON.parse(result.content) as unknown
}

describe("OpenUltraCode OpenCode 2 plugin entry point", () => {
  it("has a stable plugin id and registers nothing when disabled", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: false })

    assert.equal(OpenUltraCodePlugin.id, "open-ultracode")
    assert.equal(ctx.sessionHooks.size, 0)
    assert.equal(ctx.permissionHooks.length, 0)
    assert.equal(ctx.toolHooks.size, 0)
    assert.equal(ctx.toolDefinitions.length, 0)
  })

  it("registers OpenCode 2 domain hooks and workflow tools without touching model routing", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })

    assert.deepEqual([...ctx.sessionHooks.keys()].sort(), ["compaction", "context", "prompt"])
    assert.equal(ctx.permissionHooks.length, 1)
    assert.deepEqual([...ctx.toolHooks.keys()], ["execute.after"])
    assert.deepEqual(
      ctx.toolDefinitions.map((tool) => tool.name).sort(),
      [
        "open_ultracode_completion_report",
        "open_ultracode_configure_fusion",
        "open_ultracode_record_blocked_check",
        "open_ultracode_record_verification",
        "open_ultracode_status"
      ]
    )
  })

  it("injects workflow continuity into the compaction transcript", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const event = { messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)

    const injected = event.messages.at(-1)
    assert.equal(injected?.role, "user")
    const text = injected?.content.map((part) => part.text ?? "").join("\n") ?? ""
    assert.match(text, /OpenUltraCode workflow continuity/i)
    assert.match(text, /Mode: build/)
    assert.match(text, /Phase: verification/)
    assert.match(text, /Goal: Preserve workflow context across compaction\./)
    assert.match(text, /Constraints:\n- Stay within Plugin Runtime\./)
    assert.match(text, /Assumptions:\n- State contains summaries only\./)
    assert.match(text, /Open findings:\n- F-1 \[high\/medium\] Unresolved tool regression/)
    assert.doesNotMatch(text, /Rejected false positive/)
    assert.match(text, /Verification:\n- VE-1 \[test:pass\] Plugin test passed\./)
    assert.match(text, /VE-2 \[audit:not-run\] Audit not run yet\. Reason: Pending implementation\. Residual risk: Security gap unknown\./)
    assert.match(text, /Degradation notices:\n- D-1 \[warning\] compaction hook: Hook payload is experimental\./)
    assert.match(text, /Completion: partial - Implementation complete; verification remains partial\./)
  })

  it("does not leak model, provider, transcript, or unrelated persisted data into compaction context", async () => {
    const projectRoot = await createProjectRoot()
    await mkdir(join(projectRoot, stateDirectory), { recursive: true })
    await writeFile(
      join(projectRoot, stateFile),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-06-15T19:00:00.000Z",
        state: {
          ...createState(),
          model: "claude-opus-4",
          provider: "anthropic",
          transcript: "secret transcript text",
          unrelatedProjectData: "do not expose"
        }
      }),
      "utf8"
    )
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const event = { messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)

    const text = event.messages.map((message) => message.content.map((part) => part.text ?? "").join("")).join("\n")
    assert.doesNotMatch(text, /claude-opus-4/)
    assert.doesNotMatch(text, /anthropic/)
    assert.doesNotMatch(text, /secret transcript text/)
    assert.doesNotMatch(text, /do not expose/)
    assert.doesNotMatch(text, /^Model:/m)
    assert.doesNotMatch(text, /^Provider:/m)
  })

  it("preserves corrupt-state degradation notices in compaction context", async () => {
    const projectRoot = await createProjectRoot()
    await mkdir(join(projectRoot, stateDirectory), { recursive: true })
    await writeFile(join(projectRoot, stateFile), "not json", "utf8")
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const event = { messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)

    const text = event.messages.map((message) => message.content.map((part) => part.text ?? "").join("")).join("\n")
    assert.match(text, /OpenUltraCode workflow continuity/i)
    assert.match(text, /Degradation notices:/)
    assert.match(text, /workflow state persistence/)
    assert.match(text, /state file was corrupt/i)
  })

  it("announces the workflow mode when an OpenUltraCode command prompt is admitted", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    const event = { prompt: { text: "Use the `open-ultracode` skill.\n\nWorkflow mode: debug\n\nUser task: fix it" } } as unknown as SessionPromptEvent

    await getSessionHook(ctx, "prompt")(event as never)

    assert.match(event.prompt.text, /OpenUltraCode mode active: debug\./)
    assert.match(event.prompt.text, /active selected opencode model is preserved/)
  })

  it("does not announce for non-OpenUltraCode prompts", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    const event = { prompt: { text: "Workflow mode: ultrathink\n\njust think" } } as unknown as SessionPromptEvent

    await getSessionHook(ctx, "prompt")(event as never)

    assert.equal(event.prompt.text, "Workflow mode: ultrathink\n\njust think")
  })

  it("applies semantic high-effort request options on model requests", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), {
      enabled: true,
      highEffort: { enabled: true, effort: "xhigh", outputTokens: 128000 }
    })
    const event = { options: {}, model: { providerID: "mistral", id: "mistral-large-4" } } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(event as never)

    assert.equal(event.options.maxTokens, 128000)
    assert.equal(event.options.reasoningEffort, "high")
  })

  it("does not mutate request options when high-effort mode is disabled", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), {
      enabled: true,
      highEffort: { enabled: false, effort: "xhigh", outputTokens: 128000 }
    })
    const event = { options: { temperature: 0.2 } } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(event as never)

    assert.deepEqual(event.options, { temperature: 0.2 })
  })

  it("records permission denials from the evaluate hook as blocked workflow status", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "execution" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await ctx.permissionHooks[0]?.({
      sessionID: "session-1",
      action: "edit",
      resources: ["src/index.ts"],
      effect: "deny",
      message: "file edit was denied by opencode permissions"
    } as never)
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { phase: string; degradations: string[]; degradationDetails: Array<Record<string, unknown>> }

    assert.equal(status.phase, "blocked")
    assert.deepEqual(status.degradations, ["D-1", "permission-denied-edit-src-index-ts"])
    assert.deepEqual(status.degradationDetails.at(-1), {
      id: "permission-denied-edit-src-index-ts",
      capability: "permission for edit src/index.ts",
      severity: "blocked",
      reason: "file edit was denied by opencode permissions",
      safeNextAction:
        "Respect the permission denial; ask the user to approve edit src/index.ts or choose a permitted alternative before retrying.",
      phase: "execution"
    })
  })

  it("records user permission rejections from permission.replied events", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "execution" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    ctx.permissionRequests.set("per_1", { action: "shell", resources: ["npm test"], message: "shell command was rejected" })

    ctx.emit({ type: "permission.replied", data: { sessionID: "session-1", requestID: "per_1", reply: "reject" } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { phase: string; degradations: string[] }

    assert.equal(status.phase, "blocked")
    assert.deepEqual(status.degradations, ["D-1", "permission-denied-shell-npm-test"])
  })

  it("records tool failures as blocked workflow status with affected phase", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "verification" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await getToolHook(ctx, "execute.after")({
      tool: "bash",
      sessionID: "session-1",
      agent: "build",
      messageID: "msg_1",
      id: "call_1",
      input: {},
      status: "error",
      error: { message: "npm test failed" }
    } as unknown as ToolExecuteAfterEvent as never)
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { phase: string; degradations: string[]; degradationDetails: Array<Record<string, unknown>> }

    assert.equal(status.phase, "blocked")
    assert.deepEqual(status.degradations, ["D-1", "phase-verification-failed"])
    assert.deepEqual(status.degradationDetails.at(-1), {
      id: "phase-verification-failed",
      capability: "workflow phase verification",
      severity: "blocked",
      reason: "bash failed: npm test failed",
      safeNextAction:
        "Stop the workflow at verification, fix or explicitly accept the issue, then rerun the phase before reporting completion.",
      phase: "verification"
    })
  })

  it("ignores successful tool executions", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await getToolHook(ctx, "execute.after")({
      tool: "read",
      status: "completed",
      result: { content: "ok" }
    } as unknown as ToolExecuteAfterEvent as never)
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { phase: string }

    assert.equal(status.phase, "verification")
  })

  it("rejects invalid typed options with actionable configuration errors", async () => {
    const ctx = createFakeContext("/tmp/open-ultracode", { enabled: "yes" })

    await assert.rejects(
      () => Promise.resolve(OpenUltraCodePlugin.setup(ctx)),
      /enabled must be a boolean when provided/
    )
  })

  it("reports workflow status from project-local state through the status tool", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const status = await executeTool(ctx, "open_ultracode_status", {}) as {
      active: boolean
      mode: string
      phase: string
      completion?: { status: string }
      degradations: string[]
      openFindings: string[]
      verification: string[]
    }

    assert.equal(status.active, true)
    assert.equal(status.mode, "build")
    assert.equal(status.phase, "verification")
    assert.equal(status.completion?.status, "partial")
    assert.deepEqual(status.degradations, ["D-1"])
    assert.deepEqual(status.openFindings, ["F-1"])
    assert.deepEqual(status.verification, ["VE-1:pass", "VE-2:not-run"])
  })

  it("records verification evidence into workflow state", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const result = await executeTool(ctx, "open_ultracode_record_verification", {
      id: "VE-3",
      kind: "build",
      result: "pass",
      summary: "Build passed.",
      command: "npm run build",
      criteriaIds: ["AC-1"]
    }) as { recorded: boolean; evidenceId?: string }
    const loaded = await store.load()

    assert.equal(result.recorded, true)
    assert.equal(result.evidenceId, "VE-3")
    assert.equal(loaded.state?.verification.at(-1)?.id, "VE-3")
    assert.equal(loaded.state?.verification.at(-1)?.result, "pass")
  })

  it("records blocked checks as blocked verification evidence", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const result = await executeTool(ctx, "open_ultracode_record_blocked_check", {
      id: "VE-4",
      kind: "audit",
      summary: "Audit could not run.",
      command: "npm audit --audit-level=high",
      criteriaIds: ["AC-1"],
      reason: "Network access was unavailable.",
      residualRisk: "High-severity dependency vulnerabilities may be unknown."
    }) as { recorded: boolean; evidenceId?: string }
    const loaded = await store.load()

    assert.equal(result.recorded, true)
    assert.equal(result.evidenceId, "VE-4")
    assert.equal(loaded.state?.verification.at(-1)?.result, "blocked")
    assert.equal(loaded.state?.verification.at(-1)?.reason, "Network access was unavailable.")
  })

  it("produces completion reports with the runtime gate logic", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(withoutCompletion({
      ...createState(),
      criteria: [
        {
          id: "AC-1",
          text: "Completion evidence maps to the criterion.",
          source: "spec",
          status: "pending",
          requirementId: "8.5"
        }
      ],
      verification: [
        {
          id: "VE-1",
          kind: "test",
          result: "pass",
          summary: "Unit tests passed.",
          command: "npm test",
          criteriaIds: ["AC-1"]
        }
      ]
    }))
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const report = await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }
    const loaded = await store.load()

    assert.equal(report.status, "verified")
    assert.equal(loaded.state?.completion?.status, "verified")
    assert.deepEqual(loaded.state?.completion?.verificationIds, ["VE-1"])
  })

  it("uses the same tool completion path for verified, partial, blocked, failed, and research-only states", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    const ctx = await setupPlugin(projectRoot, { enabled: true, verificationGate: "strict" })

    await store.update(createGateState("pass"))
    assert.equal((await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }).status, "verified")

    await store.update(createGateState("not-run"))
    assert.equal((await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }).status, "partial")

    await store.update(createGateState("blocked"))
    assert.equal((await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }).status, "blocked")

    await store.update(createGateState("fail"))
    assert.equal((await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }).status, "failed")

    const researchCtx = await setupPlugin(projectRoot, { enabled: true, verificationGate: "disabled" })
    await store.update({ ...createGateState("pass"), mode: "adversarial-research", criteria: [], verification: [] })
    assert.equal((await executeTool(researchCtx, "open_ultracode_completion_report", { researchOnly: true }) as { status: string }).status, "research-only")
  })

  it("reports partial completion instead of crashing when completion tool input is omitted", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createGateState("not-run"))
    const ctx = await setupPlugin(projectRoot, { enabled: true, verificationGate: "strict" })

    const report = await executeTool(ctx, "open_ultracode_completion_report", undefined) as { status: string; summary: string; unresolvedRisks: string[] }

    assert.equal(report.status, "partial")
    assert.match(report.summary, /not-run checks/i)
    assert(report.unresolvedRisks.some((risk) => risk.includes("VE-gate was not run")))
  })
})

function createGateState(result: "pass" | "fail" | "not-run" | "blocked"): WorkflowState {
  const state = createState()
  const evidence: VerificationEvidence =
    result === "pass"
      ? {
          id: "VE-gate",
          kind: "test" as const,
          result,
          summary: "Gate check passed.",
          command: "npm test",
          criteriaIds: ["AC-1"]
        }
      : {
          id: "VE-gate",
          kind: "test" as const,
          result,
          summary: "Gate check did not pass.",
          command: "npm test",
          criteriaIds: ["AC-1"],
          reason: "Gate check was not successful.",
          residualRisk: "Completion cannot be fully verified."
        }

  return withoutCompletion({
    ...state,
    criteria: [
      {
        id: "AC-1",
        text: "Gate status is classified consistently.",
        source: "spec",
        status: "pending",
        requirementId: "8.4"
      }
    ],
    verification: [evidence]
  })
}

function withoutCompletion(state: WorkflowState): WorkflowState {
  const { completion: _completion, ...rest } = state

  return rest
}

function createState(): WorkflowState {
  const updatedAt = "2026-06-15T19:00:00.000Z"

  return {
    schemaVersion: 1,
    sessionId: "session-1",
    mode: "build",
    phase: "verification",
    startedAt: "2026-06-15T18:00:00.000Z",
    updatedAt,
    goal: "Preserve workflow context across compaction.",
    constraints: ["Stay within Plugin Runtime."],
    assumptions: ["State contains summaries only."],
    criteria: [
      {
        id: "AC-1",
        text: "Compaction context includes active phase.",
        source: "spec",
        status: "verified",
        requirementId: "2.3"
      }
    ],
    findings: [
      {
        id: "F-1",
        severity: "high",
        confidence: "medium",
        title: "Unresolved tool regression",
        evidence: ["Tool behavior still needs verification."],
        impact: "Workflow may complete with an unresolved issue.",
        recommendation: "Keep finding open until reconciled."
      },
      {
        id: "F-2",
        severity: "low",
        confidence: "low",
        title: "Rejected false positive",
        evidence: ["Reviewed and rejected."],
        impact: "None.",
        recommendation: "No action.",
        disposition: "rejected",
        dispositionReason: "Evidence does not support the finding."
      }
    ],
    verification: [
      {
        id: "VE-1",
        kind: "test",
        result: "pass",
        summary: "Plugin test passed.",
        command: "npm test -- tests/plugin.test.ts",
        criteriaIds: ["AC-1"]
      },
      {
        id: "VE-2",
        kind: "audit",
        result: "not-run",
        summary: "Audit not run yet.",
        reason: "Pending implementation.",
        residualRisk: "Security gap unknown.",
        criteriaIds: []
      }
    ],
    degradations: [
      {
        id: "D-1",
        capability: "compaction hook",
        severity: "warning",
        reason: "Hook payload is experimental.",
        userVisibleMessage: "Compaction context uses the supported experimental hook.",
        safeNextAction: "Continue with visible workflow summary.",
        occurredAt: updatedAt,
        phase: "verification"
      }
    ],
    completion: {
      status: "partial",
      summary: "Implementation complete; verification remains partial.",
      criteria: [],
      unresolvedRisks: ["Audit has not run."],
      verificationIds: ["VE-1", "VE-2"],
      findingIds: ["F-1"],
      assumptions: ["State contains summaries only."]
    }
  }
}
