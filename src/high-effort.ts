import { createHighEffortLimitationNotice } from "./degradation.js"
import type { DegradationNotice, HighEffortLevel, HighEffortOptions } from "./types.js"

export interface HighEffortApplyResult {
  readonly appliedFields: readonly string[]
  readonly degradation?: DegradationNotice
}

export type ChatParams = Record<string, unknown>

export function applyHighEffortRequestBehavior(
  options: HighEffortOptions,
  params: ChatParams
): HighEffortApplyResult {
  if (!options.enabled) {
    return { appliedFields: [] }
  }

  const appliedFields: string[] = []
  const providerOptions = isRecord(params.options) ? params.options : undefined

  if (options.outputTokens !== undefined) {
    applyOutputTokenBudget(params, "max_tokens", options.outputTokens, appliedFields)
    applyOutputTokenBudget(params, "maxTokens", options.outputTokens, appliedFields)
    if (providerOptions !== undefined) {
      applyOutputTokenBudget(providerOptions, "max_tokens", options.outputTokens, appliedFields, "options.")
      applyOutputTokenBudget(providerOptions, "maxTokens", options.outputTokens, appliedFields, "options.")
    }
  }

  applyReasoningEffort(params, options.effort, appliedFields)
  if (providerOptions !== undefined) {
    applyReasoningEffort(providerOptions, options.effort, appliedFields, "options.")
  }

  if (appliedFields.length > 0) {
    return { appliedFields }
  }

  return {
    appliedFields,
    degradation: createHighEffortLimitationNotice({
      reason: "no supported request fields were present for high-effort controls"
    })
  }
}

function applyOutputTokenBudget(
  params: ChatParams,
  field: "max_tokens" | "maxTokens",
  outputTokens: number,
  appliedFields: string[],
  prefix = ""
): void {
  if (typeof params[field] !== "number") {
    return
  }

  params[field] = Math.max(params[field], outputTokens)
  appliedFields.push(`${prefix}${field}`)
}

function applyReasoningEffort(
  params: ChatParams,
  effort: HighEffortLevel,
  appliedFields: string[],
  prefix = ""
): void {
  const providerEffort = toProviderReasoningEffort(effort)

  if (typeof params.reasoning_effort === "string") {
    params.reasoning_effort = strongestReasoningEffort(params.reasoning_effort, providerEffort)
    appliedFields.push(`${prefix}reasoning_effort`)
  }

  if (typeof params.reasoningEffort === "string") {
    params.reasoningEffort = strongestReasoningEffort(params.reasoningEffort, providerEffort)
    appliedFields.push(`${prefix}reasoningEffort`)
  }

  const reasoning = params.reasoning
  if (isRecord(reasoning) && typeof reasoning.effort === "string") {
    reasoning.effort = strongestReasoningEffort(reasoning.effort, providerEffort)
    appliedFields.push(`${prefix}reasoning.effort`)
  }
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

function toProviderReasoningEffort(effort: HighEffortLevel): "medium" | "high" {
  return effort === "medium" ? "medium" : "high"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
