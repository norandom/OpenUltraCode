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

/** What the selected model allows, when opencode knows it. */
export interface ModelLimits {
  /** Maximum output tokens of the model (`limit.output`). */
  readonly outputTokens?: number
}

export function applyHighEffortRequestBehavior(
  options: HighEffortOptions,
  params: ChatParams,
  limits: ModelLimits = {}
): HighEffortApplyResult {
  if (!options.enabled) {
    return { appliedFields: [] }
  }

  const appliedFields: string[] = []

  if (options.outputTokens !== undefined) {
    const requested = typeof params.maxTokens === "number" ? Math.max(params.maxTokens, options.outputTokens) : options.outputTokens
    // Never ask for more output than the model supports; providers reject such requests.
    params.maxTokens = limits.outputTokens !== undefined && limits.outputTokens > 0 ? Math.min(requested, limits.outputTokens) : requested
    appliedFields.push("maxTokens")
  }

  const requested = toProviderReasoningEffort(options.effort)
  params.reasoningEffort =
    typeof params.reasoningEffort === "string" ? strongestReasoningEffort(params.reasoningEffort, requested) : requested
  appliedFields.push("reasoningEffort")

  return { appliedFields }
}

/**
 * The plugin never sends "xhigh" itself: providers reject it (Mistral answers 400 Bad Request
 * for reasoning_effort "xhigh" while "high" succeeds), and a model offering an opencode "max"
 * variant says nothing about which raw values its API accepts. A stronger effort the user
 * selected through opencode (for example a variant) is still kept by strongestReasoningEffort.
 */
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
