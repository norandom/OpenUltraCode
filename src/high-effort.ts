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

  if (options.outputTokens !== undefined) {
    applyOutputTokenBudget(params, "max_tokens", options.outputTokens, appliedFields)
    applyOutputTokenBudget(params, "maxTokens", options.outputTokens, appliedFields)
  }

  applyReasoningEffort(params, options.effort, appliedFields)

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
  appliedFields: string[]
): void {
  if (typeof params[field] !== "number") {
    return
  }

  params[field] = Math.max(params[field], outputTokens)
  appliedFields.push(field)
}

function applyReasoningEffort(params: ChatParams, effort: HighEffortLevel, appliedFields: string[]): void {
  const providerEffort = toProviderReasoningEffort(effort)

  if (typeof params.reasoning_effort === "string") {
    params.reasoning_effort = providerEffort
    appliedFields.push("reasoning_effort")
  }

  const reasoning = params.reasoning
  if (isRecord(reasoning) && typeof reasoning.effort === "string") {
    reasoning.effort = providerEffort
    appliedFields.push("reasoning.effort")
  }
}

function toProviderReasoningEffort(effort: HighEffortLevel): "medium" | "high" {
  return effort === "medium" ? "medium" : "high"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
