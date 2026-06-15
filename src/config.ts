import {
  adversarialPolicies,
  gatePolicies,
  highEffortLevels,
  type OpenUltraCodeOptions
} from "./types.js"

const defaultOptions: OpenUltraCodeOptions = {
  enabled: true,
  adversarialReview: "required",
  verificationGate: "strict",
  highEffort: {
    enabled: true,
    effort: "xhigh",
    outputTokens: 64000
  },
  state: {
    directory: ".opencode/open-ultracode/state",
    persistTranscripts: false
  },
  notices: {
    showDegradation: true
  }
}

type UnknownRecord = Record<string, unknown>

export type OpenUltraCodeOptionsInput = {
  readonly enabled?: unknown
  readonly adversarialReview?: unknown
  readonly verificationGate?: unknown
  readonly highEffort?: {
    readonly enabled?: unknown
    readonly effort?: unknown
    readonly outputTokens?: unknown
  }
  readonly state?: {
    readonly directory?: unknown
    readonly persistTranscripts?: unknown
  }
  readonly notices?: {
    readonly showDegradation?: unknown
  }
}

export type OpenUltraCodeConfigResult =
  | {
      readonly ok: true
      readonly value: OpenUltraCodeOptions
    }
  | {
      readonly ok: false
      readonly errors: readonly string[]
    }

export function parseOpenUltraCodeOptions(input: unknown): OpenUltraCodeConfigResult {
  const errors: string[] = []
  const options = readOptionsInput(input, errors)
  const highEffortOptions = readSection(options?.highEffort, "highEffort", errors)
  const stateOptions = readSection(options?.state, "state", errors)
  const noticeOptions = readSection(options?.notices, "notices", errors)

  const enabled = readBoolean(options?.enabled, defaultOptions.enabled, "enabled", errors)
  const adversarialReview = readEnum(
    options?.adversarialReview,
    defaultOptions.adversarialReview,
    adversarialPolicies,
    "adversarialReview",
    errors
  )
  const verificationGate = readEnum(
    options?.verificationGate,
    defaultOptions.verificationGate,
    gatePolicies,
    "verificationGate",
    errors
  )
  const highEffortEnabled = readBoolean(
    highEffortOptions?.enabled,
    defaultOptions.highEffort.enabled,
    "highEffort.enabled",
    errors
  )
  const highEffort = readEnum(
    highEffortOptions?.effort,
    defaultOptions.highEffort.effort,
    highEffortLevels,
    "highEffort.effort",
    errors
  )
  const outputTokens = readOutputTokens(highEffortOptions?.outputTokens, defaultOptions.highEffort.outputTokens, errors)
  const stateDirectory = readStateDirectory(stateOptions?.directory, defaultOptions.state.directory, errors)
  const persistTranscripts = readPersistTranscripts(stateOptions?.persistTranscripts, errors)
  const showDegradation = readBoolean(
    noticeOptions?.showDegradation,
    defaultOptions.notices.showDegradation,
    "notices.showDegradation",
    errors
  )

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  if (!enabled) {
    return {
      ok: true,
      value: {
        enabled: false,
        adversarialReview: "disabled",
        verificationGate: "disabled",
        highEffort: {
          enabled: false,
          effort: highEffort
        },
        state: {
          directory: stateDirectory,
          persistTranscripts
        },
        notices: {
          showDegradation
        }
      }
    }
  }

  return {
    ok: true,
    value: {
      enabled,
      adversarialReview,
      verificationGate,
      highEffort: {
        enabled: highEffortEnabled,
        effort: highEffort,
        ...(outputTokens === undefined ? {} : { outputTokens })
      },
      state: {
        directory: stateDirectory,
        persistTranscripts
      },
      notices: {
        showDegradation
      }
    }
  }
}

function readOptionsInput(value: unknown, errors: string[]): UnknownRecord | undefined {
  if (value === undefined) {
    return undefined
  }
  if (isPlainObject(value)) {
    return value
  }
  errors.push("options must be an object when provided")
  return undefined
}

function readSection(value: unknown, name: string, errors: string[]): UnknownRecord | undefined {
  if (value === undefined) {
    return undefined
  }
  if (isPlainObject(value)) {
    return value
  }
  errors.push(`${name} must be an object when provided`)
  return undefined
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readBoolean(value: unknown, fallback: boolean, name: string, errors: string[]): boolean {
  if (value === undefined) {
    return fallback
  }
  if (typeof value === "boolean") {
    return value
  }
  errors.push(`${name} must be a boolean when provided`)
  return fallback
}

function readEnum<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
  name: string,
  errors: string[]
): T {
  if (value === undefined) {
    return fallback
  }
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T
  }
  errors.push(`${name} must be one of: ${allowed.join(", ")}`)
  return fallback
}

function readOutputTokens(value: unknown, fallback: number | undefined, errors: string[]): number | undefined {
  if (value === undefined) {
    return fallback
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 200000) {
    return value
  }
  errors.push("highEffort.outputTokens must be an integer between 1024 and 200000 when provided")
  return fallback
}

function readStateDirectory(value: unknown, fallback: string, errors: string[]): string {
  if (value === undefined) {
    return fallback
  }
  if (typeof value === "string" && isSafeProjectRelativePath(value)) {
    return value
  }
  errors.push("state.directory must be a project-relative path and must not contain '..' segments")
  return fallback
}

function isSafeProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) {
    return false
  }
  return !value.split("/").includes("..")
}

function readPersistTranscripts(value: unknown, errors: string[]): false {
  if (value === undefined || value === false) {
    return false
  }
  errors.push("state.persistTranscripts must be false; transcript persistence is not implemented")
  return false
}
