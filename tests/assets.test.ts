import { existsSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import assert from "node:assert/strict"

const projectRoot = process.cwd()

const requiredScaffoldPaths = [
  "src",
  ".opencode/plugins",
  ".opencode/plugins/open-ultracode.ts",
  ".opencode/skills/open-ultracode",
  ".opencode/agents",
  ".opencode/commands",
  "docs",
  "tests",
  "scripts/validate-assets.ts"
] as const

describe("OpenUltraCode scaffold", () => {
  for (const relativePath of requiredScaffoldPaths) {
    it(`contains ${relativePath}`, () => {
      assert.equal(existsSync(join(projectRoot, relativePath)), true)
    })
  }
})
