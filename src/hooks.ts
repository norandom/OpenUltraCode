import type { OpenUltraCodeOptions } from "./types.js"
import type { WorkflowStateStore } from "./state.js"

export interface OpenCodePluginInput {
  readonly directory: string
}

export type OpenUltraCodeHooks = Readonly<Record<string, unknown>>

export function createOpenUltraCodeHooks(
  _input: OpenCodePluginInput,
  config: OpenUltraCodeOptions,
  _stateStore: WorkflowStateStore
): OpenUltraCodeHooks {
  if (!config.enabled) {
    return {}
  }

  return {}
}
