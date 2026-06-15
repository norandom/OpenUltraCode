import { parseOpenUltraCodeOptions, type OpenUltraCodeOptionsInput } from "./config.js"
import { createWorkflowStateStore } from "./state.js"
import { createOpenUltraCodeHooks, type OpenCodePluginInput, type OpenUltraCodeHooks } from "./hooks.js"

export type OpenUltraCodePluginFunction = (
  input: OpenCodePluginInput,
  options?: OpenUltraCodeOptionsInput
) => Promise<OpenUltraCodeHooks>

export const OpenUltraCodePlugin: OpenUltraCodePluginFunction = async (input, options) => {
  const parsed = parseOpenUltraCodeOptions(options)

  if (!parsed.ok) {
    throw new Error(`Invalid OpenUltraCode plugin options: ${parsed.errors.join("; ")}`)
  }

  const stateStore = createWorkflowStateStore(input.directory, parsed.value)

  return createOpenUltraCodeHooks(input, parsed.value, stateStore)
}

export default OpenUltraCodePlugin
