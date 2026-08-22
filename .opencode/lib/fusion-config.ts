import { access, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const fusionAgents = {
  panelA: "ultracode-fusion-panel-a.md",
  panelB: "ultracode-fusion-panel-b.md",
  decider: "ultracode-fusion-arbiter.md"
} as const

type FusionRole = keyof typeof fusionAgents

export const defaultFusionModels: FusionModels = {
  panelA: "opencode/deepseek-v4-pro#max",
  panelB: "opencode/glm-5.2#max",
  decider: "opencode/kimi-k3#max"
}

export const fusionModelReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+(?:#max)?$/u

export interface FusionModels {
  readonly panelA: string
  readonly panelB: string
  readonly decider: string
}

export interface ConfigureFusionModelsInput {
  readonly panelA?: unknown
  readonly panelB?: unknown
  readonly decider?: unknown
}

export interface ConfigureFusionModelsResult {
  readonly changed: boolean
  readonly directory: string
  readonly models: FusionModels
  readonly reasoningEffort: "max" | "mixed-or-unset"
  readonly reloadAdvice: string
}

interface FusionAgentSnapshot {
  readonly role: FusionRole
  readonly fileName: string
  readonly path: string
  readonly content: string
  readonly model: string
  readonly usesMaxReasoning: boolean
  readonly usesMaxVariant: boolean
  readonly hasLegacyThinkingOption: boolean
}

interface ModelSelection {
  readonly reference: string
  readonly variant?: string
}

interface FrontmatterDocument {
  readonly opening: string
  readonly source: string
  readonly newline: "\n" | "\r\n"
  readonly remainder: string
}

export async function configureFusionModels(
  projectRoot: string,
  input: ConfigureFusionModelsInput = {}
): Promise<ConfigureFusionModelsResult> {
  const directory = await findFusionAgentDirectory(projectRoot)
  const snapshots = await readFusionAgents(directory)
  const current = modelsFromSnapshots(snapshots)
  const hasUpdates = input.panelA !== undefined || input.panelB !== undefined || input.decider !== undefined
  const requested = hasUpdates ? readRequestedModels(input, current) : current
  const updates = hasUpdates
    ? snapshots.filter(
        (snapshot) =>
          snapshot.model !== requested[snapshot.role] ||
          !snapshot.usesMaxReasoning ||
          !snapshot.usesMaxVariant ||
          snapshot.hasLegacyThinkingOption
      )
    : []

  if (updates.length > 0) {
    await updateFusionAgents(updates, requested)
  }

  return {
    changed: updates.length > 0,
    directory,
    models: requested,
    reasoningEffort: updates.length > 0 || snapshots.every(
      (snapshot) => snapshot.usesMaxReasoning && snapshot.usesMaxVariant
    )
      ? "max"
      : "mixed-or-unset",
    reloadAdvice: "Quit and restart OpenCode to load the updated fusion agent metadata before the next fusion run."
  }
}

function readRequestedModels(input: ConfigureFusionModelsInput, current: FusionModels): FusionModels {
  if (!isRecord(input)) {
    throw new TypeError("tool input must be an object")
  }

  return {
    panelA: readModelReference(input.panelA, current.panelA, "panelA"),
    panelB: readModelReference(input.panelB, current.panelB, "panelB"),
    decider: readModelReference(input.decider, current.decider, "decider")
  }
}

function readModelReference(value: unknown, fallback: string, name: string): string {
  if (value === undefined) {
    return withMaxVariant(fallback)
  }
  if (typeof value !== "string" || !isModelReference(value)) {
    throw new TypeError(`${name} must be a provider/model reference with no variant or the #max variant`)
  }
  return withMaxVariant(value)
}

export function isModelReference(value: string): boolean {
  return fusionModelReferencePattern.test(value)
}

function withMaxVariant(value: string): string {
  return `${value.replace(/#[^#]+$/u, "")}#max`
}

async function findFusionAgentDirectory(projectRoot: string): Promise<string> {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const candidates = [
    join(projectRoot, ".opencode", "agents"),
    process.env.OPENCODE_CONFIG_DIR === undefined ? undefined : join(process.env.OPENCODE_CONFIG_DIR, "agents"),
    xdgConfigHome === undefined ? undefined : join(xdgConfigHome, "opencode", "agents"),
    join(homedir(), ".config", "opencode", "agents")
  ].filter((candidate): candidate is string => candidate !== undefined)
  const uniqueCandidates = [...new Set(candidates)]

  for (const candidate of uniqueCandidates) {
    const count = await countFusionAgents(candidate)
    if (count === Object.keys(fusionAgents).length) {
      return candidate
    }
    if (count > 0) {
      throw new Error(
        `Found a partial fusion-agent override in ${candidate}. Install all three fusion agents in one scope before changing their models.`
      )
    }
  }

  throw new Error(`Could not find installed fusion agents in: ${uniqueCandidates.join(", ")}`)
}

async function countFusionAgents(directory: string): Promise<number> {
  const present = await Promise.all(
    Object.values(fusionAgents).map(async (fileName) => {
      try {
        await access(join(directory, fileName))
        return true
      } catch {
        return false
      }
    })
  )
  return present.filter(Boolean).length
}

async function readFusionAgents(directory: string): Promise<readonly FusionAgentSnapshot[]> {
  return Promise.all(
    (Object.entries(fusionAgents) as readonly [FusionRole, string][]).map(async ([role, fileName]) => {
      const path = join(directory, fileName)
      const content = await readFile(path, "utf8")
      const frontmatter = readFrontmatter(content, fileName)
      const selection = readFrontmatterModelSelection(frontmatter.source, fileName)
      return {
        role,
        fileName,
        path,
        content,
        model: selection.reference,
        usesMaxReasoning: readUsesMaxReasoning(frontmatter.source, fileName),
        usesMaxVariant: selection.variant === "max",
        hasLegacyThinkingOption: /^thinking:[ \t]*\r?\n[ \t]+type:[ \t]*enabled[ \t]*$/mu.test(frontmatter.source)
      }
    })
  )
}

function modelsFromSnapshots(snapshots: readonly FusionAgentSnapshot[]): FusionModels {
  return Object.fromEntries(snapshots.map((snapshot) => [snapshot.role, snapshot.model])) as unknown as FusionModels
}

function readFrontmatter(content: string, fileName: string): FrontmatterDocument {
  const opening = /^---(\r?\n)/u.exec(content)
  if (opening?.[1] === undefined) {
    throw new Error(`${fileName} must begin with YAML frontmatter`)
  }

  const closingPattern = /\r?\n---(?=\r?\n|$)/gu
  closingPattern.lastIndex = opening[0].length
  const closing = closingPattern.exec(content)
  if (closing === null) {
    throw new Error(`${fileName} must contain a closing YAML frontmatter delimiter`)
  }

  return {
    opening: opening[0],
    source: content.slice(opening[0].length, closing.index),
    newline: opening[1] as "\n" | "\r\n",
    remainder: content.slice(closing.index + closing[0].length)
  }
}

function readFrontmatterModel(frontmatter: string, fileName: string): string {
  const matches = [...frontmatter.matchAll(/^model:[ \t]*(\S+)[ \t]*$/gmu)]
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(`${fileName} must contain exactly one model frontmatter field`)
  }
  return matches[0][1]
}

function readFrontmatterModelSelection(frontmatter: string, fileName: string): ModelSelection {
  const model = readFrontmatterModel(frontmatter, fileName)
  const variantMatches = [...frontmatter.matchAll(/^variant:[ \t]*(\S+)[ \t]*$/gmu)]
  if (variantMatches.length > 1) {
    throw new Error(`${fileName} must contain at most one variant frontmatter field`)
  }
  const separateVariant = variantMatches[0]?.[1]
  const inlineVariant = /#([^#]+)$/u.exec(model)?.[1]
  if (separateVariant !== undefined && inlineVariant !== undefined) {
    throw new Error(`${fileName} must not set both an inline and separate model variant`)
  }

  const variant = separateVariant ?? inlineVariant
  const baseModel = inlineVariant === undefined ? model : model.slice(0, -(inlineVariant.length + 1))
  if (!isModelReference(baseModel)) {
    throw new Error(`${fileName} model must be a provider/model reference`)
  }
  return {
    reference: variant === undefined ? baseModel : `${baseModel}#${variant}`,
    ...(variant === undefined ? {} : { variant })
  }
}

function readUsesMaxReasoning(frontmatter: string, fileName: string): boolean {
  const matches = [...frontmatter.matchAll(/^reasoningEffort:[ \t]*(\S+)[ \t]*$/gmu)]
  if (matches.length > 1) {
    throw new Error(`${fileName} must contain at most one reasoningEffort frontmatter field`)
  }
  return matches[0]?.[1] === "max"
}

async function updateFusionAgents(
  snapshots: readonly FusionAgentSnapshot[],
  models: FusionModels
): Promise<void> {
  const updates = snapshots.map((snapshot) => ({
    ...snapshot,
    updated: setFusionAgentOptions(snapshot.content, models[snapshot.role], snapshot.fileName)
  }))
  const temporaryPaths: string[] = []
  const renamed: typeof updates = []

  try {
    for (const update of updates) {
      const temporaryPath = `${update.path}.${process.pid}.${temporaryPaths.length}.tmp`
      await writeFile(temporaryPath, update.updated, { encoding: "utf8", flag: "wx" })
      temporaryPaths.push(temporaryPath)
    }

    const currentContents = await Promise.all(updates.map((update) => readFile(update.path, "utf8")))
    for (const [index, update] of updates.entries()) {
      if (currentContents[index] !== update.content) {
        throw new Error(`${update.fileName} changed while the fusion configuration update was being prepared`)
      }
    }

    for (const [index, update] of updates.entries()) {
      const temporaryPath = temporaryPaths[index]
      if (temporaryPath === undefined) throw new Error("missing temporary fusion agent update")
      await rename(temporaryPath, update.path)
      renamed.push(update)
    }
  } catch (error) {
    await Promise.all(temporaryPaths.map(async (path) => unlink(path).catch(() => undefined)))
    await Promise.all(renamed.map(async (update) => writeFile(update.path, update.content, "utf8")))
    throw error
  }
}

function setFusionAgentOptions(content: string, model: string, fileName: string): string {
  const document = readFrontmatter(content, fileName)
  readFrontmatterModelSelection(document.source, fileName)
  readUsesMaxReasoning(document.source, fileName)
  const baseModel = model.replace(/#max$/u, "")
  let updated = document.source.replace(/^model:[ \t]*\S+[ \t]*$/mu, `model: ${baseModel}`)

  if (/^variant:/mu.test(updated)) {
    updated = updated.replace(/^variant:[^\r\n]*$/mu, "variant: max")
  } else {
    updated = updated.replace(/^model:[^\r\n]*$/mu, (line) => `${line}${document.newline}variant: max`)
  }

  if (/^reasoningEffort:/mu.test(updated)) {
    updated = updated.replace(/^reasoningEffort:[^\r\n]*$/mu, "reasoningEffort: max")
  } else {
    updated = updated.replace(/^model:[^\r\n]*$/mu, (line) => `${line}${document.newline}reasoningEffort: max`)
  }

  updated = updated.replace(
    /^thinking:[ \t]*\r?\n[ \t]+type:[ \t]*enabled[ \t]*(?:\r?\n|$)/mu,
    ""
  )

  return `${document.opening}${updated}${document.newline}---${document.remainder}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
