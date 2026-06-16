import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import assert from "node:assert/strict"

type CommandExpectation = Readonly<{
  file: string
  mode: string
  phases: readonly string[]
}>

const commandExpectations: readonly CommandExpectation[] = [
  {
    file: "ultracode.md",
    mode: "comprehensive",
    phases: ["Intake", "Planning", "Execution", "Adversarial Review", "Reconciliation", "Verification"]
  },
  {
    file: "ultracode-debug.md",
    mode: "debug",
    phases: ["Intake", "Reproduce", "Root Cause", "Fix", "Verification"]
  },
  {
    file: "ultracode-spec-audit.md",
    mode: "spec-audit",
    phases: ["Extract Criteria", "Gap Analysis", "Adversarial Review", "Findings"]
  },
  {
    file: "ultracode-research.md",
    mode: "adversarial-research",
    phases: ["Research Question", "Attack The Plan", "Evidence", "Findings"]
  },
  {
    file: "ultracode-verify.md",
    mode: "verify",
    phases: ["Evidence Inventory", "Run Checks", "Completion Report"]
  },
  {
    file: "ultracode-fusion.md",
    mode: "comprehensive",
    phases: ["Intake", "Planning", "Execution", "Adversarial Review", "Reconciliation", "Verification"]
  }
] as const

function readCommand(file: string): string {
  return readFileSync(join(process.cwd(), ".opencode/commands", file), "utf8")
}

describe("OpenUltraCode command assets", () => {
  for (const command of commandExpectations) {
    it(`${command.file} has valid command routing guidance`, () => {
      const content = readCommand(command.file)

      assert.match(content, /^---\n[\s\S]+?\n---/)
      assert.match(content, /^description:\s*.+$/m)
      assert.match(content, /\$ARGUMENTS/)
      assert.match(content, new RegExp(`mode:\\s*${command.mode}`, "i"))
      assert.match(content, /selected model/i)
      assert.match(content, /missing task context|not provide enough task context/i)
      assert.match(content, /ask focused questions/i)
      assert.doesNotMatch(content, /^model:/m)
      assert.doesNotMatch(content, /override the selected model/i)

      for (const phase of command.phases) {
        assert.match(content, new RegExp(phase, "i"), `missing ${phase} phase`)
      }
    })
  }

  it("ultracode-fusion.md defines explicit fusion protocol routing", () => {
    const content = readCommand("ultracode-fusion.md")

    assert.match(content, /--panel/i)
    assert.match(content, /--decider/i)
    assert.match(content, /exactly two/i)
    assert.match(content, /critique-revise-vote/i)
    assert.match(content, /bounded context package/i)
    assert.match(content, /subagent dispatch contract/i)
    assert.match(content, /arbitration rubric/i)
    assert.match(content, /selected-model|selected model/i)
    assert.match(content, /no proxy|do not introduce a proxy/i)
    assert.match(content, /synthetic model ID/i)
  })
})
