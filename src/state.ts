import { randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import type { DegradationNotice, PersistedWorkflowState, WorkflowState } from "./types.js"

const stateFileName = "workflow-state.json"

export interface WorkflowStateLoadResult {
  readonly state: WorkflowState | undefined
  readonly degradations: readonly DegradationNotice[]
}

export interface WorkflowStateStore {
  readonly load: () => Promise<WorkflowStateLoadResult>
  readonly update: (state: WorkflowState) => Promise<void>
  /**
   * Loads, changes, and writes the state as one step. Mutations of the same state file are
   * serialized within the process, so concurrent hooks and tools cannot drop each other's
   * changes. Returning undefined leaves the state unchanged.
   */
  readonly mutate: (change: (state: WorkflowState) => WorkflowState | undefined) => Promise<WorkflowState | undefined>
  readonly clear: () => Promise<void>
}

// One queue per state file and process: every plugin instance and tool shares it.
const mutationQueues: Map<string, Promise<unknown>> = ((globalThis as Record<symbol, unknown>)[Symbol.for("open-ultracode.state-queues")] ??= new Map<string, Promise<unknown>>()) as Map<string, Promise<unknown>>

export interface WorkflowStateStoreConfig {
  readonly state: {
    readonly directory: string
  }
}

export function createWorkflowStateStore(
  projectRoot: string,
  config: WorkflowStateStoreConfig
): WorkflowStateStore {
  const root = resolve(projectRoot)
  const statePath = resolveStatePath(projectRoot, config.state.directory)

  const store: WorkflowStateStore = {
    async load(): Promise<WorkflowStateLoadResult> {
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)

      let raw: string
      try {
        raw = await retryTransient(() => readFile(statePath, "utf8"))
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return { state: undefined, degradations: [] }
        }
        // I/O errors are not corruption: never move a valid but busy state file aside.
        throw error
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        return backupCorrupt(error)
      }
      if (!isPersistedWorkflowState(parsed)) {
        return backupCorrupt(new Error("state file did not match the expected schema"))
      }

      return { state: parsed.state, degradations: [] }
    },

    mutate(change) {
      const previous = mutationQueues.get(statePath) ?? Promise.resolve()
      const next = previous.catch(() => {}).then(async () => {
        const { state } = await store.load()
        if (state === undefined) return undefined
        const changed = change(state)
        if (changed === undefined) return state
        await store.update(changed)
        return changed
      })
      mutationQueues.set(statePath, next)
      void next.finally(() => {
        if (mutationQueues.get(statePath) === next) mutationQueues.delete(statePath)
      }).catch(() => {})
      return next
    },

    async update(state: WorkflowState): Promise<void> {
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)
      await mkdir(dirname(statePath), { recursive: true })
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)
      const persisted: PersistedWorkflowState = {
        schemaVersion: 1,
        updatedAt: state.updatedAt,
        state
      }
      await writeStateAtomically(statePath, `${JSON.stringify(persisted, null, 2)}\n`)
    },

    async clear(): Promise<void> {
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)
      await rm(statePath, { force: true })
    }
  }

  async function backupCorrupt(error: unknown): Promise<WorkflowStateLoadResult> {
    await backupCorruptState(statePath)
    return { state: undefined, degradations: [createCorruptStateNotice(error)] }
  }

  return store
}

const transientErrorCodes = new Set(["EPERM", "EACCES", "EBUSY"])

/**
 * Windows reports EPERM/EACCES/EBUSY while another handle (a concurrent read, an indexer,
 * antivirus) holds the file; the operation succeeds a few milliseconds later.
 */
async function retryTransient<T>(operation: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= attempts || !isNodeError(error) || error.code === undefined || !transientErrorCodes.has(error.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 5 * attempt))
    }
  }
}

async function writeStateAtomically(statePath: string, contents: string): Promise<void> {
  const stateDirectory = dirname(statePath)
  const stagingDirectory = await mkdtemp(resolve(stateDirectory, `.workflow-state-write-${randomUUID()}-`))
  const stagingPath = resolve(stagingDirectory, stateFileName)

  try {
    await writeFile(stagingPath, contents, { encoding: "utf8", flag: "wx" })
    await retryTransient(() => rename(stagingPath, statePath))
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true })
  }
}

function resolveStatePath(projectRoot: string, stateDirectory: string): string {
  if (!isSafeProjectRelativePath(stateDirectory)) {
    throw new Error("state.directory must be a project-relative path and must not contain '..' segments or backslashes")
  }

  const root = resolve(projectRoot)
  const statePath = resolve(root, stateDirectory, stateFileName)

  if (statePath !== root && !statePath.startsWith(`${root}${sep}`)) {
    throw new Error("state.directory must resolve inside the project root")
  }

  return statePath
}

function isSafeProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) {
    return false
  }

  return !value.split("/").includes("..")
}

async function rejectSymlinkedStatePath(root: string, stateDirectory: string, statePath: string): Promise<void> {
  let current = root

  for (const segment of stateDirectory.split("/")) {
    current = resolve(current, segment)

    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        throw new Error("state.directory must not contain symlinks")
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return
      }

      throw error
    }
  }

  try {
    const stats = await lstat(statePath)
    if (stats.isSymbolicLink()) {
      throw new Error("state.directory must not contain symlinks")
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error
    }
  }
}

async function backupCorruptState(statePath: string): Promise<void> {
  try {
    await retryTransient(() => rename(statePath, `${statePath}.bak`))
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error
    }
  }
}

function createCorruptStateNotice(error: unknown): DegradationNotice {
  const reason = error instanceof Error ? error.message : "State file could not be read."

  return {
    id: "workflow-state-corrupt",
    capability: "workflow state persistence",
    severity: "warning",
    reason,
    userVisibleMessage: "The OpenUltraCode workflow state file was corrupt and has been ignored for safety.",
    safeNextAction: "Continue with a new workflow state; inspect workflow-state.json.bak if prior context is needed.",
    occurredAt: new Date().toISOString()
  }
}

function isPersistedWorkflowState(value: unknown): value is PersistedWorkflowState {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.updatedAt !== "string") {
    return false
  }

  const state = value.state

  return isRecord(state) && state.schemaVersion === 1 && typeof state.mode === "string" && typeof state.phase === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
