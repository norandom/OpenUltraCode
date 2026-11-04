import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
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
import { absentProviderModel, modelList, models, providers, ref } from "./fixtures/models.js"

const asEvent = (model: { providerID: string; id: string }) => ({ providerID: model.providerID, id: model.id })
const pattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&"), "u")

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
  readonly permissionAsserts: Array<{ action: string; resources: readonly string[] }>
  denyPermissionAsserts: boolean
}

function createFakeContext(directory: string, options: unknown, sessionDirectory = directory): FakeContext {
  const sessionHooks = new Map<string, (event: never) => unknown>()
  const permissionHooks: Array<(event: never) => unknown> = []
  const toolHooks = new Map<string, (event: never) => unknown>()
  const toolDefinitions: ToolDefinition[] = []
  const events: Array<{ type: string; data: Record<string, unknown> }> = []
  const listeners: Array<(event: { type: string; data: Record<string, unknown> }) => void> = []
  const permissionRequests = new Map<string, { action: string; resources: readonly string[]; message?: string }>()
  const permissionAsserts: Array<{ action: string; resources: readonly string[] }> = []

  const ctx: FakeContext = {
    location: { directory: sessionDirectory, project: { directory } },
    options,
    sessionHooks,
    permissionHooks,
    toolHooks,
    toolDefinitions,
    events,
    permissionRequests,
    permissionAsserts,
    denyPermissionAsserts: false,
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
        // The real client unwraps the response body and resolves to the request itself.
        return Promise.resolve(request)
      },
      assert(input: { action: string; resources: readonly string[] }) {
        permissionAsserts.push({ action: input.action, resources: input.resources })
        return ctx.denyPermissionAsserts ? Promise.reject(new Error("permission denied by the user")) : Promise.resolve()
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
    } as unknown as OpenCodePluginContext["event"],
    model: {
      list() {
        return Promise.resolve({
          data: [
            ...modelList
          ]
        })
      }
    }
  }

  return ctx
}

async function setupPlugin(directory: string, options: unknown, sessionDirectory = directory): Promise<FakeContext> {
  const ctx = createFakeContext(directory, options, sessionDirectory)
  await OpenUltraCodePlugin.setup(ctx)
  return ctx
}

const toolContext = {
  sessionID: "session-1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1"
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
  const result = await tool.execute(input, { ...toolContext, signal: new AbortController().signal })
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
        "open_ultracode_list_models",
        "open_ultracode_record_blocked_check",
        "open_ultracode_record_intake",
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

    const event = { system: [], messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)
    await getSessionHook(ctx, "compaction")(event as never)

    // Continuity goes into one plain system part; the transcript itself is left untouched.
    assert.deepEqual(event.messages, [])
    assert.equal(event.system.length, 1, "a repeated compaction hook must not duplicate the context")
    assert.equal(event.system[0]?.type, "text")
    const text = event.system[0]?.text ?? ""
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
          model: "secret-model-id",
          provider: "secret-provider-id",
          transcript: "secret transcript text",
          unrelatedProjectData: "do not expose"
        }
      }),
      "utf8"
    )
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    const event = { system: [], messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)

    const text = event.system.map((part) => part.text).join("\n")
    assert.doesNotMatch(text, /secret-model-id/)
    assert.doesNotMatch(text, /secret-provider-id/)
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

    const event = { system: [], messages: [] } as unknown as SessionCompactionEvent
    await getSessionHook(ctx, "compaction")(event as never)

    const text = event.system.map((part) => part.text).join("\n")
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
    const event = { options: {}, model: asEvent(models.withMax) } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(event as never)

    assert.equal(event.options.maxTokens, 128000)
    assert.equal(event.options.reasoningEffort, "high")
  })

  it("never sends reasoning effort xhigh, which Mistral rejects with 400 Bad Request", async () => {
    // A model declaring low/high/max succeeds with reasoning_effort "high"; providers reject "xhigh".
    // succeeded with reasoning_effort "high" and failed with "xhigh".
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    const event = { options: { maxTokens: 256000 }, model: asEvent(models.withMax) } as unknown as SessionContextEvent
    const userChoice = { options: { reasoningEffort: "max" }, model: asEvent(models.withMax) } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(event as never)
    await getSessionHook(ctx, "context")(userChoice as never)

    assert.deepEqual(event.options, { maxTokens: 256000, reasoningEffort: "high" })
    // A stronger effort that opencode itself already set is kept, never overwritten.
    assert.equal(userChoice.options.reasoningEffort, "max")
  })

  it("clamps high-effort output tokens and effort to what the selected model supports", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), {
      enabled: true,
      highEffort: { enabled: true, effort: "xhigh", outputTokens: 128000 }
    })
    const small = { options: {}, model: asEvent(models.small) } as unknown as SessionContextEvent
    const unknown = { options: {}, model: { providerID: providers.other, id: "not-listed" } } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(small as never)
    await getSessionHook(ctx, "context")(unknown as never)

    assert.deepEqual(small.options, { maxTokens: 8192, reasoningEffort: "high" })
    // Without model information the configured token budget applies and no effort is guessed.
    assert.deepEqual(unknown.options, { maxTokens: 128000 })
  })

  it("sends no reasoning effort to a model that declares no variants", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    const event = { options: { maxTokens: 256000 }, model: asEvent(models.noVariants) } as unknown as SessionContextEvent

    await getSessionHook(ctx, "context")(event as never)

    assert.deepEqual(event.options, { maxTokens: 256000 })
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
    // The event loop records the rejection asynchronously; poll instead of sleeping a fixed time.
    let status = { phase: "", degradations: [] as string[] }
    for (const deadline = Date.now() + 5000; status.phase !== "blocked" && Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      status = await executeTool(ctx, "open_ultracode_status", {}) as typeof status
    }

    assert.equal(status.phase, "blocked")
    assert.deepEqual(status.degradations, ["D-1", "permission-denied-shell-npm-test"])
  })

  it("notes ordinary tool errors without blocking the workflow", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "execution" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await getToolHook(ctx, "execute.after")({
      tool: "grep",
      status: "error",
      error: { message: "no matches" }
    } as unknown as ToolExecuteAfterEvent as never)
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { phase: string; degradationDetails: Array<Record<string, unknown>> }

    assert.equal(status.phase, "execution")
    assert.deepEqual(status.degradationDetails.at(-1), {
      id: "tool-error-grep",
      capability: "tool grep",
      severity: "warning",
      reason: "no matches",
      safeNextAction: "Check whether the grep failure affects the result; record a blocked check if required evidence could not be produced.",
      phase: "execution"
    })
  })

  it("records failures of the workflow's own tools as blocked workflow status with affected phase", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "verification" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await getToolHook(ctx, "execute.after")({
      tool: "open_ultracode_record_verification",
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
      reason: "open_ultracode_record_verification failed: npm test failed",
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

    // A second plugin instance for the same project is ignored, so research mode uses its own project.
    const researchRoot = await createProjectRoot()
    const researchStore = createWorkflowStateStore(researchRoot, { state: { directory: stateDirectory } })
    const researchCtx = await setupPlugin(researchRoot, { enabled: true, verificationGate: "disabled" })
    await researchStore.update({ ...createGateState("pass"), mode: "adversarial-research", criteria: [], verification: [] })
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

describe("OpenUltraCode workflow lifecycle in OpenCode 2", () => {
  async function commandPrompt(command: string, task: string): Promise<SessionPromptEvent> {
    const template = await readFile(join(process.cwd(), ".opencode", "commands", command), "utf8")
    const text = template.replace(/^---[\s\S]*?---\r?\n/u, "").replaceAll("$ARGUMENTS", task)
    return { sessionID: "session-1", messageID: "msg_1", delivery: "queue", prompt: { text } } as unknown as SessionPromptEvent
  }

  it("starts a workflow from a real command and completes it through the tools, without pre-seeded state", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true, verificationGate: "strict" })
    assert.equal((await executeTool(ctx, "open_ultracode_status", {}) as { active: boolean }).active, false)

    await getSessionHook(ctx, "prompt")(await commandPrompt("ultracode.md", "Add a --dry-run flag") as never)
    const started = await executeTool(ctx, "open_ultracode_status", {}) as { active: boolean; mode: string; phase: string; goal: string }
    assert.deepEqual([started.active, started.mode, started.phase, started.goal], [true, "build", "intake", "Add a --dry-run flag"])

    const intake = await executeTool(ctx, "open_ultracode_record_intake", {
      criteria: [{ id: "AC-1", text: "--dry-run prints the plan and changes nothing" }],
      phase: "verification"
    }) as { recorded: boolean; phase: string; criteriaIds: string[] }
    assert.deepEqual(intake, { recorded: true, phase: "verification", criteriaIds: ["AC-1"] })

    const recorded = await executeTool(ctx, "open_ultracode_record_verification", {
      id: "VE-1", kind: "test", result: "pass", summary: "dry-run test passes", criteriaIds: ["AC-1"], command: "pnpm test"
    }) as { recorded: boolean }
    assert.equal(recorded.recorded, true)
    assert.equal((await executeTool(ctx, "open_ultracode_completion_report", {}) as { status: string }).status, "verified")
  })

  it("announces every command mode once, including ultrathink, and ignores bare mode lines", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    const event = await commandPrompt("ultrathink.md", "Why is the cache cold?")

    await getSessionHook(ctx, "prompt")(event as never)
    await getSessionHook(ctx, "prompt")(event as never)

    assert.equal(event.prompt.text.split("OpenUltraCode mode active: ultrathink.").length - 1, 1)
    assert.equal((await executeTool(ctx, "open_ultracode_status", {}) as { mode: string }).mode, "adversarial-research")

    const bare = { sessionID: "session-1", prompt: { text: "Workflow mode: debug" } } as unknown as SessionPromptEvent
    await getSessionHook(ctx, "prompt")(bare as never)
    assert.equal(bare.prompt.text, "Workflow mode: debug")
  })

  it("keeps an unfinished workflow for follow-up prompts and starts fresh for another session", async () => {
    const ctx = await setupPlugin(await createProjectRoot(), { enabled: true })
    await getSessionHook(ctx, "prompt")(await commandPrompt("ultracode-debug.md", "first") as never)
    await executeTool(ctx, "open_ultracode_record_intake", { constraints: ["no network"] })

    await getSessionHook(ctx, "prompt")(await commandPrompt("ultracode-debug.md", "follow-up") as never)
    assert.equal((await executeTool(ctx, "open_ultracode_status", {}) as { goal: string }).goal, "first")

    const other = await commandPrompt("ultracode-debug.md", "other session")
    await getSessionHook(ctx, "prompt")({ ...other, sessionID: "session-2" } as never)
    assert.equal((await executeTool(ctx, "open_ultracode_status", {}) as { goal: string }).goal, "other session")
  })

  it("stores state in the project root when opencode runs in a subdirectory", async () => {
    const projectRoot = await createProjectRoot()
    const subdirectory = join(projectRoot, "packages", "app")
    await mkdir(subdirectory, { recursive: true })
    const ctx = await setupPlugin(projectRoot, { enabled: true }, subdirectory)

    await getSessionHook(ctx, "prompt")(await commandPrompt("ultracode.md", "task") as never)

    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    assert.equal((await store.load()).state?.goal, "task")
  })

  it("ignores a second plugin instance for the same project", async () => {
    const projectRoot = await createProjectRoot()
    await setupPlugin(projectRoot, { enabled: true })
    const duplicate = await setupPlugin(projectRoot, { enabled: true })

    assert.equal(duplicate.sessionHooks.size, 0)
    assert.equal(duplicate.toolDefinitions.length, 0)
  })

  it("never fails the host operation when the plugin itself fails", async () => {
    const projectRoot = await createProjectRoot()
    // A regular file where the state directory belongs makes every state read fail.
    await mkdir(join(projectRoot, ".opencode"), { recursive: true })
    await writeFile(join(projectRoot, ".opencode", "open-ultracode"), "not a directory")
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    const originalError = console.error
    const logged: string[] = []
    console.error = (message: unknown) => { logged.push(String(message)) }
    try {
      await assert.doesNotReject(async () => getSessionHook(ctx, "compaction")({ system: [], messages: [] } as never))
      await assert.doesNotReject(async () => getSessionHook(ctx, "prompt")(await commandPrompt("ultracode.md", "x") as never))
      await assert.doesNotReject(async () => getToolHook(ctx, "execute.after")({ tool: "bash", status: "error", error: { message: "boom" } } as never))
    } finally {
      console.error = originalError
    }
    // Which hooks fail depends on the platform (Windows reports ENOENT where POSIX reports ENOTDIR).
    assert.ok(logged.length >= 1 && logged.every((line) => line.startsWith("OpenUltraCode: ")), logged.join("\n"))
  })

  it("does not lose evidence when verification is recorded concurrently", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), verification: [] })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await Promise.all(Array.from({ length: 12 }, (_, index) => executeTool(ctx, "open_ultracode_record_verification", {
      id: `VE-${index}`, kind: "test", result: "pass", summary: `check ${index}`, criteriaIds: ["AC-1"]
    })))

    assert.equal((await store.load()).state?.verification.length, 12)
  })

  it("only blocks on denied tool calls, not on rules evaluated for agent tool lists", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "execution" })
    const ctx = await setupPlugin(projectRoot, { enabled: true })

    await ctx.permissionHooks[0]?.({ sessionID: "s", action: "open_ultracode_configure_fusion", resources: [], effect: "deny", source: { type: "agent" } } as never)
    assert.equal((await store.load()).state?.phase, "execution")

    await ctx.permissionHooks[0]?.({ sessionID: "s", action: "bash", resources: ["rm"], effect: "deny", source: { type: "tool", messageID: "m", id: "c" } } as never)
    assert.equal((await store.load()).state?.phase, "blocked")
  })

  it("asks for permission before rewriting fusion agents and stops when denied", async () => {
    const projectRoot = await createProjectRoot()
    const agents = join(projectRoot, ".opencode", "agents")
    await mkdir(agents, { recursive: true })
    for (const name of ["ultracode-fusion-panel-a.md", "ultracode-fusion-panel-b.md", "ultracode-fusion-arbiter.md"]) {
      await writeFile(join(agents, name), await readFile(join(process.cwd(), "assets", "agents", name), "utf8"))
    }
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    const panelA = join(agents, "ultracode-fusion-panel-a.md")

    await executeTool(ctx, "open_ultracode_configure_fusion", {})
    assert.equal(ctx.permissionAsserts.length, 0, "reading the configuration must not prompt")

    ctx.denyPermissionAsserts = true
    const before = await readFile(panelA, "utf8")
    await assert.rejects(() => executeTool(ctx, "open_ultracode_configure_fusion", { panelA: ref(models.noVariants) }), /denied/u)
    assert.equal(await readFile(panelA, "utf8"), before, "a denied update must not touch agent files")

    ctx.denyPermissionAsserts = false
    await executeTool(ctx, "open_ultracode_configure_fusion", { panelA: ref(models.noVariants) })
    assert.deepEqual(ctx.permissionAsserts.map((request) => request.action), ["open_ultracode_configure_fusion", "open_ultracode_configure_fusion"])
    assert.ok((await readFile(panelA, "utf8")).split(/\r?\n/u).includes(`model: ${ref(models.noVariants)}`))
  })

  async function fusionProject(models: { panelA: string; panelB: string; decider: string }): Promise<string> {
    const projectRoot = await createProjectRoot()
    const agents = join(projectRoot, ".opencode", "agents")
    await mkdir(agents, { recursive: true })
    const files = { panelA: "ultracode-fusion-panel-a.md", panelB: "ultracode-fusion-panel-b.md", decider: "ultracode-fusion-arbiter.md" }
    for (const [role, file] of Object.entries(files)) {
      const reference = models[role as keyof typeof models]
      const variant = reference.endsWith("#max") ? "variant: max\nreasoningEffort: max\n" : ""
      await writeFile(join(agents, file), `---\ndescription: Fusion role.\nmode: subagent\nmodel: ${reference.replace(/#max$/u, "")}\n${variant}---\n\nRole.\n`)
    }
    return projectRoot
  }

  it("refuses a fusion variant the model does not declare and accepts declared ones", async () => {
    const ctx = await setupPlugin(await fusionProject({ panelA: ref(models.withMax, "max"), panelB: ref(models.otherFamilyWithMax, "max"), decider: ref(models.withMax, "max") }), { enabled: true })

    await assert.rejects(
      () => executeTool(ctx, "open_ultracode_configure_fusion", { panelA: ref(models.noVariants, "max") }),
      (error: Error) => error.message.includes(`Fusion panel A uses ${ref(models.noVariants, "max")}, but opencode reports no "max" variant`) &&
        error.message.includes(`Suggested fallback: ${ref(models.noVariants)}`) && error.message.includes(`--panel-a ${ref(models.noVariants)}.`)
    )
    assert.equal(ctx.permissionAsserts.length, 0, "an invalid request must fail before asking for permission")

    await executeTool(ctx, "open_ultracode_configure_fusion", { panelA: ref(models.noVariants), panelB: ref(models.otherFamilyWithMax, "max") })
    assert.equal(ctx.permissionAsserts.length, 1)
  })

  it("warns before fusion dispatch when a fusion agent selects a variant its model does not declare", async () => {
    // opencode refuses such an agent: "Subagent failed: Variant unavailable for <model>: max".
    const projectRoot = await fusionProject({ panelA: ref(models.noVariants, "max"), panelB: ref(models.otherFamilyWithMax, "max"), decider: ref(models.noVariantsDated, "max") })
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    const template = await readFile(join(process.cwd(), ".opencode", "commands", "ultrathink-fusion.md"), "utf8")
    const event = { sessionID: "session-1", prompt: { text: template.replace(/^---[\s\S]*?---\r?\n/u, "").replaceAll("$ARGUMENTS", "question") } } as unknown as SessionPromptEvent

    await getSessionHook(ctx, "prompt")(event as never)
    await getSessionHook(ctx, "prompt")(event as never)

    assert.equal(event.prompt.text.split("OpenUltraCode fusion check:").length - 1, 1)
    assert.match(event.prompt.text, pattern(`Fusion panel A uses ${ref(models.noVariants, "max")}`))
    assert.match(event.prompt.text, pattern(`Fusion arbiter uses ${ref(models.noVariantsDated, "max")}`))
    assert.doesNotMatch(event.prompt.text, /Fusion panel B uses/u)
    // The coordinator proposes the fallback and asks the user before changing anything.
    assert.match(event.prompt.text, pattern(`Suggested fallback: ${ref(models.noVariants)}`))
    assert.match(event.prompt.text, /ask the user to confirm it or name another model\. Wait for the answer\./u)
    assert.match(event.prompt.text, /open_ultracode_list_models/u)
    assert.match(event.prompt.text, /cannot be asked .*for this run only .*do not change the fusion configuration/u)
    const status = await executeTool(ctx, "open_ultracode_status", {}) as { degradations: string[] }
    assert.ok(status.degradations.includes("unsupported-fusion-panel-a-model"), status.degradations.join(", "))

    const valid = await setupPlugin(await fusionProject({ panelA: ref(models.noVariants), panelB: ref(models.otherFamilyWithMax, "max"), decider: ref(models.withMax, "max") }), { enabled: true })
    const clean = { sessionID: "session-1", prompt: { text: template.replace(/^---[\s\S]*?---\r?\n/u, "").replaceAll("$ARGUMENTS", "question") } } as unknown as SessionPromptEvent
    await getSessionHook(valid, "prompt")(clean as never)
    assert.doesNotMatch(clean.prompt.text, /OpenUltraCode fusion check:/u)
  })

  it("reports an unavailable provider before dispatch and lists valid models per provider", async () => {
    // A provider opencode does offer (but not as the user's main provider) must not be flagged.
    const projectRoot = await fusionProject({ panelA: ref(models.sameModelOtherProvider), panelB: ref(models.otherFamilyWithMax, "max"), decider: ref(models.withMax, "max") })
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    const template = await readFile(join(process.cwd(), ".opencode", "commands", "ultracode-fusion.md"), "utf8")
    const event = { sessionID: "session-1", prompt: { text: template.replace(/^---[\s\S]*?---\r?\n/u, "").replaceAll("$ARGUMENTS", "task") } } as unknown as SessionPromptEvent

    await getSessionHook(ctx, "prompt")(event as never)
    assert.doesNotMatch(event.prompt.text, /OpenUltraCode fusion check:/u)

    const missing = await setupPlugin(await fusionProject({ panelA: absentProviderModel, panelB: ref(models.otherFamilyWithMax, "max"), decider: ref(models.withMax, "max") }), { enabled: true })
    const missingEvent = { sessionID: "session-1", prompt: { text: template.replace(/^---[\s\S]*?---\r?\n/u, "").replaceAll("$ARGUMENTS", "task") } } as unknown as SessionPromptEvent
    await getSessionHook(missing, "prompt")(missingEvent as never)
    assert.match(missingEvent.prompt.text, pattern(`Fusion panel A uses ${absentProviderModel}, but provider ${providers.absent} is not available in opencode right now`))

    const listed = await executeTool(ctx, "open_ultracode_list_models", { provider: providers.user }) as { available: boolean; providers: Record<string, Array<{ reference: string; maxReference?: string }>> }
    assert.equal(listed.available, true)
    assert.deepEqual(Object.keys(listed.providers), [providers.user])
    assert.deepEqual(listed.providers[providers.user]?.find((model) => model.reference === ref(models.withMax)), { reference: ref(models.withMax), variants: ["low", "high", "max"], maxReference: ref(models.withMax, "max") })
    assert.deepEqual(listed.providers[providers.user]?.find((model) => model.reference === ref(models.noVariants)), { reference: ref(models.noVariants), variants: [] })
  })

  it("advertises exactly the fields its validators require", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const ctx = await setupPlugin(projectRoot, { enabled: true })
    const valid: Record<string, Record<string, unknown>> = {
      open_ultracode_record_verification: { id: "VE-9", kind: "test", result: "fail", summary: "s", criteriaIds: [], reason: "r", residualRisk: "x" },
      open_ultracode_record_blocked_check: { id: "VE-10", kind: "audit", summary: "s", criteriaIds: [], reason: "r", residualRisk: "x" }
    }

    for (const [name, input] of Object.entries(valid)) {
      const required = (getTool(ctx, name).input as { required: string[] }).required
      await executeTool(ctx, name, input)
      for (const key of required.filter((field) => field !== "criteriaIds")) {
        const { [key]: _omitted, ...missing } = input
        await assert.rejects(() => executeTool(ctx, name, missing), TypeError, `${name} accepted input without required ${key}`)
      }
    }
    assert.ok((getTool(ctx, "open_ultracode_record_verification").input as { required: string[] }).required.includes("result"))
  })
})
