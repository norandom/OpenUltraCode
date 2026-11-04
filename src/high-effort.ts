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

/** What opencode reports for the selected model (`ctx.model.list()`). */
export interface ModelLimits {
  /** Maximum output tokens of the model (`limit.output`). */
  readonly outputTokens?: number
  /**
   * Variant IDs the model offers, for example ["low", "high", "max"]. These are the reasoning
   * efforts the provider declares for the model; an empty list means it declares none.
   * Undefined when opencode does not list the model.
   */
  readonly variants?: readonly string[]
}

const effortStrength: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6
}

const configuredStrength: Readonly<Record<HighEffortLevel, number>> = { medium: 3, high: 4, xhigh: 5 }

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

  const effort = selectReasoningEffort(options.effort, limits.variants)
  if (effort !== undefined && !isAtLeast(params.reasoningEffort, effort)) {
    params.reasoningEffort = effort
    appliedFields.push("reasoningEffort")
  }

  return { appliedFields }
}

/**
 * Picks the strongest effort the model itself declares (its variant IDs) that does not exceed
 * the configured level. Raw values outside that list are rejected by providers: Mistral answers
 * 400 for "xhigh", and for any reasoning_effort on models that declare no variants
 * (vibe-oidc/mistral-large-latest). No variants, or an unknown model, means no effort is sent.
 */
export function selectReasoningEffort(configured: HighEffortLevel, variants: readonly string[] | undefined): string | undefined {
  if (variants === undefined) return undefined
  const limit = configuredStrength[configured]
  let selected: string | undefined
  for (const variant of variants) {
    const strength = effortStrength[variant]
    if (strength === undefined || strength < effortStrength.low! || strength > limit) continue
    if (selected === undefined || strength > (effortStrength[selected] ?? -1)) selected = variant
  }
  return selected
}

/** A stronger effort that opencode already set (for example from a selected variant) is kept. */
function isAtLeast(current: unknown, effort: string): boolean {
  if (typeof current !== "string") return false
  const currentStrength = effortStrength[current]
  return currentStrength !== undefined && currentStrength >= (effortStrength[effort] ?? Number.POSITIVE_INFINITY)
}
