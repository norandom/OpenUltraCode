import { parseOpenUltraCodeOptions, type OpenUltraCodeOptionsInput } from "./config.js"
import { createWorkflowStateStore } from "./state.js"
import { registerOpenUltraCode } from "./hooks.js"
import type { OpenCodePluginContext, OpenCodePluginDefinition } from "./opencode-v2.js"

export type { OpenCodePluginContext, OpenCodePluginDefinition }

/**
 * OpenCode 2 plugin entry point. OpenCode 2 loads a default export with a
 * stable `id` and a `setup(ctx)` that registers hooks, transforms, tools, and
 * event subscriptions through the plugin context.
 */
export const OpenUltraCodePlugin: OpenCodePluginDefinition = {
  id: "open-ultracode",
  async setup(ctx: OpenCodePluginContext) {
    const parsed = parseOpenUltraCodeOptions(ctx.options as OpenUltraCodeOptionsInput)

    if (!parsed.ok) {
      throw new Error(`Invalid OpenUltraCode plugin options: ${parsed.errors.join("; ")}`)
    }

    // State and fusion agents belong to the project, even when opencode runs in a subdirectory.
    const projectDirectory = ctx.location.project.directory
    const stateStore = createWorkflowStateStore(projectDirectory, parsed.value)

    return registerOpenUltraCode(ctx, parsed.value, stateStore, projectDirectory)
  }
}

export default OpenUltraCodePlugin
