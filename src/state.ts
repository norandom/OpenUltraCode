import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
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
  readonly clear: () => Promise<void>
}

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

  return {
    async load(): Promise<WorkflowStateLoadResult> {
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)

      try {
        const raw = await readFile(statePath, "utf8")
        const parsed: unknown = JSON.parse(raw)

        if (!isPersistedWorkflowState(parsed)) {
          throw new Error("state file did not match the expected schema")
        }

        return { state: parsed.state, degradations: [] }
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return { state: undefined, degradations: [] }
        }

        await backupCorruptState(statePath)
        return { state: undefined, degradations: [createCorruptStateNotice(error)] }
      }
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
      const temporaryPath = `${statePath}.${process.pid}.tmp`

      await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8")
      await rename(temporaryPath, statePath)
    },

    async clear(): Promise<void> {
      await rejectSymlinkedStatePath(root, config.state.directory, statePath)
      await rm(statePath, { force: true })
    }
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
    await rename(statePath, `${statePath}.bak`)
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
