import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import assert from "node:assert/strict"

type AgentExpectation = Readonly<{
  file: string
  role: string
  required: readonly RegExp[]
}>

const agentExpectations: readonly AgentExpectation[] = [
  {
    file: "open-ultracode.md",
    role: "coordinator",
    required: [/workflow mode/i, /phase/i, /delegate/i, /completion gate/i]
  },
  {
    file: "open-ultracode-planner.md",
    role: "planner",
    required: [/plan/i, /assumption/i, /acceptance criteria/i, /selected model/i]
  },
  {
    file: "open-ultracode-implementer.md",
    role: "implementer",
    required: [/smallest safe change/i, /evidence/i, /do not bypass permissions/i, /selected model/i]
  },
  {
    file: "open-ultracode-adversary.md",
    role: "adversary",
    required: [/finding/i, /severity/i, /confidence/i, /affected requirement/i]
  },
  {
    file: "open-ultracode-reconciler.md",
    role: "reconciler",
    required: [/disposition/i, /rejection reason/i, /unresolved/i, /safe next step/i]
  },
  {
    file: "open-ultracode-verifier.md",
    role: "verifier",
    required: [/fresh evidence/i, /verified/i, /partial/i, /blocked/i]
  },
  {
    file: "open-ultracode-researcher.md",
    role: "researcher",
    required: [/adversarial research/i, /incomplete spec/i, /evidence/i, /research-only/i]
  }
] as const

function readAgent(file: string): string {
  return readFileSync(join(process.cwd(), ".opencode/agents", file), "utf8")
}

describe("OpenUltraCode agent assets", () => {
  for (const agent of agentExpectations) {
    it(`${agent.file} has safe subagent guidance`, () => {
      const content = readAgent(agent.file)

      assert.match(content, /^---\n[\s\S]+?\n---/)
      assert.match(content, /^description:\s*.+$/m)
      assert.match(content, /^mode:\s*subagent$/m)
      assert.match(content, /^permission:/m)
      assert.doesNotMatch(content, /^model:/m)
      assert.doesNotMatch(content, /override the selected model/i)
      assert.match(content, /inherit the active selected model/i)
      assert.match(content, /do not change provider/i)
      assert.match(content, /structured output/i)
      assert.match(content, new RegExp(agent.role, "i"))

      for (const requiredText of agent.required) {
        assert.match(content, requiredText)
      }
    })
  }
})
