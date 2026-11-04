import type { Plugin } from "@opencode/plugin"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { OpenUltraCodePlugin } from "../src/plugin.js"
import type { OpenCodePluginContext, OpenCodePluginDefinition } from "../src/opencode-v2.js"

// Compile-time contract against the real OpenCode 2 plugin API (@opencode/plugin, devDependency).
// src/opencode-v2.ts describes only the surface the plugin uses so tests can fake it; `tsc`
// (part of `pnpm run check`) fails here whenever that description drifts from the real API.

// The real context must be usable wherever the plugin expects its narrow context.
export const realContextFitsPluginContext = (context: Plugin.Context): OpenCodePluginContext => context
// The plugin definition must be a valid OpenCode 2 plugin module.
export const pluginFitsRealDefinition = (plugin: OpenCodePluginDefinition): Plugin.Plugin => plugin
OpenUltraCodePlugin satisfies Plugin.Plugin

describe("OpenCode 2 plugin contract", () => {
  it("exports a stable plugin id and setup function", () => {
    assert.equal(OpenUltraCodePlugin.id, "open-ultracode")
    assert.equal(typeof OpenUltraCodePlugin.setup, "function")
  })
})
