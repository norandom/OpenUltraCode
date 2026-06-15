import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import assert from "node:assert/strict"

const skillPath = join(process.cwd(), ".opencode/skills/open-ultracode/SKILL.md")

function readSkill(): string {
  return readFileSync(skillPath, "utf8")
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  assert.ok(match, `missing ${key} frontmatter`)
  return match[1]?.trim() ?? ""
}

describe("OpenUltraCode skill asset", () => {
  it("has valid frontmatter and trigger guidance", () => {
    const content = readSkill()

    assert.match(content, /^---\n[\s\S]+?\n---/)
    assert.equal(frontmatterValue(content, "name"), "open-ultracode")
    assert.match(frontmatterValue(content, "description"), /Use when/i)
    assert.match(frontmatterValue(content, "description"), /ultracode|workflow|spec|debug/i)
  })

  it("defines the required workflow phases and role sequence", () => {
    const content = readSkill()

    for (const phase of [
      "Intake",
      "Planning",
      "Execution",
      "Adversarial Review",
      "Reconciliation",
      "Verification"
    ]) {
      assert.match(content, new RegExp(phase, "i"), `missing ${phase} phase`)
    }

    for (const role of ["coordinator", "planner", "implementer", "adversary", "reconciler", "verifier"]) {
      assert.match(content, new RegExp(role, "i"), `missing ${role} role`)
    }
  })

  it("covers assumptions, incomplete specs, debug loops, and fallback behavior", () => {
    const content = readSkill()

    for (const requiredText of [
      /assumption/i,
      /incomplete spec/i,
      /debug loop/i,
      /spec-audit/i,
      /single-session fallback/i,
      /simple-task shortcut/i,
      /proportional verification/i,
      /selected model/i,
      /do not claim completion/i
    ]) {
      assert.match(content, requiredText)
    }
  })
})
