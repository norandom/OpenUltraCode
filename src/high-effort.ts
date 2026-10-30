import type { HighEffortLevel, HighEffortOptions } from "./types.js"

export interface HighEffortApplyResult {
  readonly appliedFields: readonly string[]
}

/**
 * OpenCode 2 request overrides. The `context` session hook starts with an empty
 * options object per model call; typed keys are semantic generation settings and
 * any other key is passed to the selected protocol as a provider option.
 */
export type ChatParams = Record<string, unknown>

export function applyHighEffortRequestBehavior(
  options: HighEffortOptions,
  params: ChatParams
): HighEffortApplyResult {
  if (!options.enabled) {
    return { appliedFields: [] }
  }

  const appliedFields: string[] = []

  if (options.outputTokens !== undefined) {
    params.maxTokens =
      typeof params.maxTokens === "number" ? Math.max(params.maxTokens, options.outputTokens) : options.outputTokens
    appliedFields.push("maxTokens")
  }

  const requested = toProviderReasoningEffort(options.effort)
  params.reasoningEffort =
    typeof params.reasoningEffort === "string" ? strongestReasoningEffort(params.reasoningEffort, requested) : requested
  appliedFields.push("reasoningEffort")

  return { appliedFields }
}

function toProviderReasoningEffort(effort: HighEffortLevel): "medium" | "high" {
  return effort === "medium" ? "medium" : "high"
}

function strongestReasoningEffort(current: string, requested: "medium" | "high"): string {
  const strength: Readonly<Record<string, number>> = {
    none: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    max: 6
  }
  const currentStrength = strength[current]
  const requestedStrength = strength[requested]
  return currentStrength !== undefined && requestedStrength !== undefined && currentStrength > requestedStrength
    ? current
    : requested
}
