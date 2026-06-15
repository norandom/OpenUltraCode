import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { OpenUltraCodePlugin, createWorkflowStateStore, type OpenUltraCodeHooks, type WorkflowState } from "../src/index.js"

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
    assert.equal("experimental" in hooks, false)
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
