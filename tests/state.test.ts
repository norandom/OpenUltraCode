import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { createWorkflowStateStore, type WorkflowState } from "../src/index.js"

const stateDirectory = ".opencode/open-ultracode/state"
const stateFile = join(stateDirectory, "workflow-state.json")

describe("workflow state store", () => {
  it("loads missing state as inactive without creating files", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })

    const loaded = await store.load()

    assert.deepEqual(loaded, { state: undefined, degradations: [] })
    assert.equal(existsSync(join(projectRoot, stateFile)), false)
  })

  it("updates and reloads minimal project-local workflow state", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })
    const state = createState()

    await store.update(state)
    const loaded = await store.load()
    const raw = JSON.parse(await readFile(join(projectRoot, stateFile), "utf8")) as unknown

    assert.deepEqual(loaded, { state, degradations: [] })
    assert.deepEqual(raw, {
      schemaVersion: 1,
      updatedAt: state.updatedAt,
      state
    })
  })

  it("clears state safely when present or missing", async () => {
    const projectRoot = await createProjectRoot()
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })

    await store.clear()
    await store.update(createState())
    assert.equal(existsSync(join(projectRoot, stateFile)), true)

    await store.clear()
    await store.clear()

    assert.equal(existsSync(join(projectRoot, stateFile)), false)
  })

  it("recovers corrupt state with a visible degradation notice and backup", async () => {
    const projectRoot = await createProjectRoot()
    await mkdir(join(projectRoot, stateDirectory), { recursive: true })
    await writeFile(join(projectRoot, stateFile), "not json", "utf8")
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })

    const loaded = await store.load()

    assert.equal(loaded.state, undefined)
    assert.equal(loaded.degradations.length, 1)
    assert.equal(loaded.degradations[0]?.capability, "workflow state persistence")
    assert.equal(loaded.degradations[0]?.severity, "warning")
    assert.match(loaded.degradations[0]?.userVisibleMessage ?? "", /state file was corrupt/i)
    assert.equal(existsSync(join(projectRoot, `${stateFile}.bak`)), true)
    assert.equal(existsSync(join(projectRoot, stateFile)), false)
  })

  it("rejects state directories that can escape the project root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "open-ultracode-parent-"))
    const projectRoot = join(parent, "project")
    await mkdir(projectRoot)

    assert.throws(
      () => createWorkflowStateStore(projectRoot, { state: { directory: "../outside" } }),
      /state.directory must be a project-relative path/
    )
    assert.throws(
      () => createWorkflowStateStore(projectRoot, { state: { directory: "/tmp/outside" } }),
      /state.directory must be a project-relative path/
    )
    assert.throws(
      () => createWorkflowStateStore(projectRoot, { state: { directory: "open\\ultracode" } }),
      /state.directory must be a project-relative path/
    )

    assert.equal(existsSync(join(parent, "outside", "workflow-state.json")), false)

    await rm(parent, { recursive: true, force: true })
  })

  it("rejects symlinked state path components before writing state", async () => {
    const parent = await mkdtemp(join(tmpdir(), "open-ultracode-symlink-"))
    const projectRoot = join(parent, "project")
    const outsideRoot = join(parent, "outside")
    await mkdir(join(projectRoot, ".opencode", "open-ultracode"), { recursive: true })
    await mkdir(outsideRoot)
    await symlink(outsideRoot, join(projectRoot, ".opencode", "open-ultracode", "state"), "dir")
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })

    await assert.rejects(() => store.update(createState()), /state.directory must not contain symlinks/)
    assert.equal(existsSync(join(outsideRoot, "workflow-state.json")), false)

    await rm(parent, { recursive: true, force: true })
  })

  it("rejects symlinked state path components before loading without backing up outside state", async () => {
    const parent = await mkdtemp(join(tmpdir(), "open-ultracode-load-symlink-"))
    const projectRoot = join(parent, "project")
    const outsideRoot = join(parent, "outside")
    await mkdir(join(projectRoot, ".opencode", "open-ultracode"), { recursive: true })
    await mkdir(outsideRoot)
    await writeFile(join(outsideRoot, "workflow-state.json"), "not json", "utf8")
    await symlink(outsideRoot, join(projectRoot, ".opencode", "open-ultracode", "state"), "dir")
    const store = createWorkflowStateStore(projectRoot, { state: { directory: stateDirectory } })

    await assert.rejects(() => store.load(), /state.directory must not contain symlinks/)
    assert.equal(existsSync(join(outsideRoot, "workflow-state.json")), true)
    assert.equal(existsSync(join(outsideRoot, "workflow-state.json.bak")), false)

    await rm(parent, { recursive: true, force: true })
  })
})

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-ultracode-state-"))
}

function createState(): WorkflowState {
  const updatedAt = "2026-06-15T18:30:00.000Z"

  return {
    schemaVersion: 1,
    sessionId: "session-1",
    mode: "build",
    phase: "verification",
    startedAt: "2026-06-15T18:00:00.000Z",
    updatedAt,
    goal: "Persist workflow state.",
    constraints: ["Keep state project-local."],
    assumptions: ["State file contains summaries, not transcripts."],
    criteria: [
      {
        id: "AC-1",
        text: "State can be loaded after update.",
        source: "spec",
        status: "verified",
        requirementId: "2.3"
      }
    ],
    findings: [
      {
        id: "F-1",
        severity: "low",
        confidence: "high",
        title: "State is local only",
        evidence: ["workflow-state.json is under the configured project state directory."],
        impact: "Project data stays within the project root.",
        recommendation: "Keep rejecting escaping state directories."
      }
    ],
    verification: [
      {
        id: "VE-1",
        kind: "test",
        result: "pass",
        summary: "State store test passed.",
        command: "npm test -- tests/state.test.ts",
        criteriaIds: ["AC-1"]
      }
    ],
    degradations: [
      {
        id: "D-1",
        capability: "workflow state persistence",
        severity: "notice",
        reason: "State persisted with minimal fields only.",
        userVisibleMessage: "Workflow state is stored locally for recovery.",
        safeNextAction: "Continue workflow.",
        occurredAt: updatedAt,
        phase: "verification"
      }
    ],
    completion: {
      status: "verified",
      summary: "State persistence verified.",
      criteria: [
        {
          id: "AC-1",
          text: "State can be loaded after update.",
          source: "spec",
          status: "verified",
          requirementId: "2.3"
        }
      ],
      unresolvedRisks: [],
      verificationIds: ["VE-1"],
      findingIds: ["F-1"],
      assumptions: ["State file contains summaries, not transcripts."]
    }
  }
}
