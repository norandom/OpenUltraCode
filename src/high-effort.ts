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
  /** Variant IDs the model offers, for example "high", "xhigh", or "max". */
  readonly variants?: readonly string[]
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

  const requested = toProviderReasoningEffort(options.effort, limits.variants)
  params.reasoningEffort =
    typeof params.reasoningEffort === "string" ? strongestReasoningEffort(params.reasoningEffort, requested) : requested
  appliedFields.push("reasoningEffort")

  return { appliedFields }
}

/** "xhigh" is only sent to models that offer an xhigh or max variant; others get "high". */
function toProviderReasoningEffort(effort: HighEffortLevel, variants: readonly string[] | undefined): "medium" | "high" | "xhigh" {
  if (effort === "medium") return "medium"
  if (effort === "xhigh" && variants !== undefined && (variants.includes("xhigh") || variants.includes("max"))) return "xhigh"
  return "high"
}

function strongestReasoningEffort(current: string, requested: "medium" | "high" | "xhigh"): string {
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
