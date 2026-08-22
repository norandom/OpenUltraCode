import { tool } from "@opencode-ai/plugin"

import { configureFusionModels, fusionModelReferencePattern } from "../lib/fusion-config.js"

export default tool({
  description:
    "Read or update the persistent OpenUltraCode fusion panel A, panel B, and decider model IDs. Every updated fusion role is configured for maximum reasoning.",
  args: {
    panelA: tool.schema.string().regex(fusionModelReferencePattern).optional().describe("Optional provider/model or provider/model#max reference for fusion panel A."),
    panelB: tool.schema.string().regex(fusionModelReferencePattern).optional().describe("Optional provider/model or provider/model#max reference for fusion panel B."),
    decider: tool.schema.string().regex(fusionModelReferencePattern).optional().describe("Optional provider/model or provider/model#max reference for the fusion decider.")
  },
  async execute(args, context) {
    const result = await configureFusionModels(context.worktree, args ?? {})
    return JSON.stringify(result, null, 2)
  }
})
