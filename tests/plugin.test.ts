import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  OpenUltraCodePlugin,
  createWorkflowStateStore,
  type CompletionReportTool,
  type OpenUltraCodeHooks,
  type RecordBlockedCheckTool,
  type RecordVerificationTool,
  type VerificationEvidence,
  type WorkflowState,
  type WorkflowStatusTool
} from "../src/index.js"

const stateDirectory = ".opencode/open-ultracode/state"
const stateFile = join(stateDirectory, "workflow-state.json")

describe("OpenUltraCode plugin entry point", () => {
  it("returns no operational hooks when disabled", async () => {
    const hooks = await OpenUltraCodePlugin({ directory: await createProjectRoot() }, { enabled: false })

    assert.deepEqual(hooks, {})
  })

  it("loads in enabled mode without changing selected provider or model", async () => {
    const hooks = await OpenUltraCodePlugin({ directory: await createProjectRoot() }, { enabled: true })

    assert.equal("model" in hooks, false)
    assert.equal("provider" in hooks, false)
  })

  it("registers a compaction hook that returns minimal workflow continuity context", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const context = await getCompactionHook(hooks)()

    assert.match(context, /OpenUltraCode workflow continuity/i)
    assert.match(context, /Mode: build/)
    assert.match(context, /Phase: verification/)
    assert.match(context, /Goal: Preserve workflow context across compaction\./)
    assert.match(context, /Constraints:\n- Stay within Plugin Runtime\./)
    assert.match(context, /Assumptions:\n- State contains summaries only\./)
    assert.match(context, /Open findings:\n- F-1 \[high\/medium\] Unresolved tool regression/)
    assert.doesNotMatch(context, /Rejected false positive/)
    assert.match(context, /Verification:\n- VE-1 \[test:pass\] Plugin test passed\./)
    assert.match(context, /VE-2 \[audit:not-run\] Audit not run yet\. Reason: Pending implementation\. Residual risk: Security gap unknown\./)
    assert.match(context, /Degradation notices:\n- D-1 \[warning\] compaction hook: Hook payload is experimental\./)
    assert.match(context, /Completion: partial - Implementation complete; verification remains partial\./)
  })

  it("registers exact opencode compaction and continuation hook keys", async () => {
    const projectRoot = await createProjectRoot()
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    assert.equal(typeof hooks["experimental.session.compacting"], "function")
    assert.equal(typeof hooks["experimental.compaction.autocontinue"], "function")
    assert.equal(typeof hooks["permission.ask"], "function")
    assert.equal(typeof hooks["tool.execute.after"], "function")
    assert.equal(typeof hooks.tool?.open_ultracode_status?.execute, "function")
    assert.equal(typeof hooks.tool?.open_ultracode_record_verification?.execute, "function")
    assert.equal(typeof hooks.tool?.open_ultracode_record_blocked_check?.execute, "function")
    assert.equal(typeof hooks.tool?.open_ultracode_completion_report?.execute, "function")
    assert.equal("experimental" in hooks, false)
  })

  it("does not register workflow tools when disabled", async () => {
    const hooks = await OpenUltraCodePlugin({ directory: await createProjectRoot() }, { enabled: false })

    assert.equal("tool" in hooks, false)
  })

  it("returns minimal continuity context from the autocontinue hook", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const context = await getAutocontinueHook(hooks)()

    assert.match(context, /OpenUltraCode workflow continuity/i)
    assert.match(context, /Mode: build/)
    assert.match(context, /Phase: verification/)
    assert.match(context, /Assumptions:\n- State contains summaries only\./)
    assert.doesNotMatch(context, /secret transcript text|unrelatedProjectData/i)
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
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const context = await getCompactionHook(hooks)()

    assert.doesNotMatch(context, /claude-opus-4/)
    assert.doesNotMatch(context, /anthropic/)
    assert.doesNotMatch(context, /secret transcript text/)
    assert.doesNotMatch(context, /do not expose/)
    assert.doesNotMatch(context, /^Model:/m)
    assert.doesNotMatch(context, /^Provider:/m)
  })

  it("preserves corrupt-state degradation notices in compaction context", async () => {
    const projectRoot = await createProjectRoot()
    await mkdir(join(projectRoot, stateDirectory), { recursive: true })
    await writeFile(join(projectRoot, stateFile), "not json", "utf8")
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const context = await getCompactionHook(hooks)()

    assert.match(context, /OpenUltraCode workflow continuity/i)
    assert.match(context, /Degradation notices:/)
    assert.match(context, /workflow state persistence/)
    assert.match(context, /state file was corrupt/i)
  })

  it("rejects invalid typed options with actionable configuration errors", async () => {
    await assert.rejects(
      () => OpenUltraCodePlugin({ directory: "/tmp/open-ultracode" }, { enabled: "yes" }),
      /enabled must be a boolean when provided/
    )
  })

  it("reports workflow status from project-local state", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const status = await getStatusTool(hooks).execute({})

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
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const result = await getRecordVerificationTool(hooks).execute({
      id: "VE-3",
      kind: "build",
      result: "pass",
      summary: "Build passed.",
      command: "npm run build",
      criteriaIds: ["AC-1"]
    })
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
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const result = await getRecordBlockedCheckTool(hooks).execute({
      id: "VE-4",
      kind: "audit",
      summary: "Audit could not run.",
      command: "npm audit --audit-level=high",
      criteriaIds: ["AC-1"],
      reason: "Network access was unavailable.",
      residualRisk: "High-severity dependency vulnerabilities may be unknown."
    })
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
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    const report = await getCompletionReportTool(hooks).execute({})
    const loaded = await store.load()

    assert.equal(report.status, "verified")
    assert.equal(loaded.state?.completion?.status, "verified")
    assert.deepEqual(loaded.state?.completion?.verificationIds, ["VE-1"])
  })

  it("uses the same tool completion path for verified, partial, blocked, failed, and research-only states", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true, verificationGate: "strict" })

    await store.update(createGateState("pass"))
    assert.equal((await getCompletionReportTool(hooks).execute({})).status, "verified")

    await store.update(createGateState("not-run"))
    assert.equal((await getCompletionReportTool(hooks).execute({})).status, "partial")

    await store.update(createGateState("blocked"))
    assert.equal((await getCompletionReportTool(hooks).execute({})).status, "blocked")

    await store.update(createGateState("fail"))
    assert.equal((await getCompletionReportTool(hooks).execute({})).status, "failed")

    const researchHooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true, verificationGate: "disabled" })
    await store.update({ ...createGateState("pass"), mode: "adversarial-research", criteria: [], verification: [] })
    assert.equal((await getCompletionReportTool(researchHooks).execute({ researchOnly: true })).status, "research-only")
  })

  it("applies high-effort hints only to supported request fields", async () => {
    const hooks = await OpenUltraCodePlugin(
      { directory: await createProjectRoot() },
      { enabled: true, highEffort: { enabled: true, effort: "high", outputTokens: 128000 } }
    )
    const params = {
      max_tokens: 4096,
      reasoning_effort: "medium"
    }

    await getChatParamsHook(hooks)({}, params)

    assert.deepEqual(params, {
      max_tokens: 128000,
      reasoning_effort: "high"
    })
  })

  it("does not invent unsupported high-effort request fields", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update(createState())
    const hooks = await OpenUltraCodePlugin(
      { directory: projectRoot },
      { enabled: true, highEffort: { enabled: true, effort: "xhigh", outputTokens: 128000 } }
    )
    const params = { temperature: 0.2 }

    await getChatParamsHook(hooks)({}, params)
    const loaded = await store.load()

    assert.deepEqual(params, { temperature: 0.2 })
    assert.equal(loaded.state?.degradations.at(-1)?.id, "high-effort-limitation")
    assert.match(loaded.state?.degradations.at(-1)?.reason ?? "", /no supported request fields/i)
  })

  it("does not mutate request params when high-effort mode is disabled", async () => {
    const hooks = await OpenUltraCodePlugin(
      { directory: await createProjectRoot() },
      { enabled: true, highEffort: { enabled: false, effort: "xhigh", outputTokens: 128000 } }
    )
    const params = {
      max_tokens: 4096,
      reasoning_effort: "medium"
    }

    await getChatParamsHook(hooks)({}, params)

    assert.deepEqual(params, {
      max_tokens: 4096,
      reasoning_effort: "medium"
    })
  })

  it("records permission denials as blocked workflow status with safe next action", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "execution" })
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    await getPermissionAskHook(hooks)(
      { operation: "edit src/index.ts" },
      { action: "deny", reason: "file edit was denied by opencode permissions" }
    )
    const status = await getStatusTool(hooks).execute({})

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

  it("records tool failures as blocked workflow status with affected phase", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    await store.update({ ...createState(), phase: "verification" })
    const hooks = await OpenUltraCodePlugin({ directory: projectRoot }, { enabled: true })

    await getToolExecuteAfterHook(hooks)(
      { tool: "bash", phase: "verification" },
      { status: "error", error: "npm test failed" }
    )
    const status = await getStatusTool(hooks).execute({})

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
})

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-ultracode-plugin-"))
}

function getCompactionHook(hooks: OpenUltraCodeHooks): () => Promise<string> {
  const hook = hooks["experimental.session.compacting"]
  if (typeof hook !== "function") {
    throw new TypeError("experimental.session.compacting hook is missing")
  }

  return hook
}

function getAutocontinueHook(hooks: OpenUltraCodeHooks): () => Promise<string> {
  const hook = hooks["experimental.compaction.autocontinue"]
  if (typeof hook !== "function") {
    throw new TypeError("experimental.compaction.autocontinue hook is missing")
  }

  return hook
}

function getStatusTool(hooks: OpenUltraCodeHooks): WorkflowStatusTool {
  const tool = hooks.tool?.open_ultracode_status
  if (tool === undefined) {
    throw new TypeError("open_ultracode_status tool is missing")
  }

  return tool
}

function getRecordVerificationTool(hooks: OpenUltraCodeHooks): RecordVerificationTool {
  const tool = hooks.tool?.open_ultracode_record_verification
  if (tool === undefined) {
    throw new TypeError("open_ultracode_record_verification tool is missing")
  }

  return tool
}

function getRecordBlockedCheckTool(hooks: OpenUltraCodeHooks): RecordBlockedCheckTool {
  const tool = hooks.tool?.open_ultracode_record_blocked_check
  if (tool === undefined) {
    throw new TypeError("open_ultracode_record_blocked_check tool is missing")
  }

  return tool
}

function getCompletionReportTool(hooks: OpenUltraCodeHooks): CompletionReportTool {
  const tool = hooks.tool?.open_ultracode_completion_report
  if (tool === undefined) {
    throw new TypeError("open_ultracode_completion_report tool is missing")
  }

  return tool
}

function getChatParamsHook(hooks: OpenUltraCodeHooks): (input: unknown, output: Record<string, unknown>) => Promise<void> {
  const hook = hooks["chat.params"]
  if (typeof hook !== "function") {
    throw new TypeError("chat.params hook is missing")
  }

  return hook
}

function getPermissionAskHook(hooks: OpenUltraCodeHooks): (input: unknown, output: Record<string, unknown>) => Promise<void> {
  const hook = hooks["permission.ask"]
  if (typeof hook !== "function") {
    throw new TypeError("permission.ask hook is missing")
  }

  return hook
}

function getToolExecuteAfterHook(hooks: OpenUltraCodeHooks): (input: unknown, output: Record<string, unknown>) => Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (typeof hook !== "function") {
    throw new TypeError("tool.execute.after hook is missing")
  }

  return hook
}

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
