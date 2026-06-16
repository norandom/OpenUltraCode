import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import assert from "node:assert/strict"

type DocExpectation = Readonly<{
  file: string
  required: readonly RegExp[]
}>

const docs: readonly DocExpectation[] = [
  {
    file: "README.md",
    required: [
      /install/i,
      /opencode/i,
      /restart/i,
      /pnpm/i,
      /install\.sh/i,
      /install-dev\.sh/i,
      /latest release/i,
      /GitHub release asset/i,
      /openai\/gpt-5/i,
      /up and down arrows/i,
      /^1\. Install the latest release with `curl -fsSL https:\/\/raw\.githubusercontent\.com\/norandom\/OpenUltraCode\/main\/install\.sh \| sh`\./im,
      /~\/\.config\/opencode/i,
      /global plugin, commands, skills, and agents/i,
      /minimumReleaseAge: 4320/i,
      /selected model/i,
      /no proxy/i,
      /does not replace/i,
      /skill is named `open-ultracode`/i,
      /not a slash command/i,
      /\/ultracode\s+"/i,
      /\/ultracode-debug\s+"/i,
      /\/ultracode-spec-audit\s+"/i,
      /\/ultracode-research\s+"/i,
      /\/ultrathink\s+"/i,
      /\/ultrathink-fusion/i,
      /grounded/i,
      /loose recall/i
    ]
  },
  {
    file: "docs/CONCEPTS.md",
    required: [
      /workflow/i,
      /coordinator/i,
      /adversarial review/i,
      /verification gate/i,
      /single-session fallback/i,
      /shim/i,
      /harness/i,
      /skill/i,
      /agent/i,
      /command/i,
      /plugin/i
    ]
  },
  {
    file: "docs/LIMITS.md",
    required: [/UltraCode-Shim/i, /high-effort/i, /hidden reasoning/i, /provider limits/i, /degradation/i]
  },
  {
    file: "docs/CONFIGURATION.md",
    required: [
      /plugin/i,
      /verificationGate/i,
      /adversarialReview/i,
      /state/i,
      /permission/i,
      /troubleshooting/i,
      /sensitive/i,
      /explicitly requests/i
    ]
  }
] as const

function readDoc(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("OpenUltraCode documentation assets", () => {
  for (const doc of docs) {
    it(`${doc.file} explains required user-facing behavior`, () => {
      const content = readDoc(doc.file)

      assert.match(content, /^#\s+\S+/m)
      assert.doesNotMatch(content, /guarantees hidden reasoning/i)
      assert.doesNotMatch(content, /bypass provider limits/i)
      assert.doesNotMatch(content, /routes requests through a proxy/i)

      for (const requiredText of doc.required) {
        assert.match(content, requiredText)
      }
    })
  }
})
