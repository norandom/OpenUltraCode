import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Tests must not depend on which providers a machine has. Behavior is described by role through
// tests/fixtures/models.ts (synthetic providers), shipped defaults are read from the repository,
// and opencode's hosted catalog providers come from the code under test (catalogProviders).

const testsRoot = join(process.cwd(), "tests")
const allowed = new Set([join(testsRoot, "fixtures", "models.ts"), join(testsRoot, "no-hardcoded-providers.test.ts")])

// A quoted `provider/...` reference to a real provider, or a real model family name.
const realProviderReference = /["'`](?:anthropic|openai|google|mistral|openrouter|azure|amazon-bedrock|github-copilot|vibe-oidc|zai|deepseek|moonshotai|xai|groq|opencode|opencode-go)\/[A-Za-z0-9~]/u
const realModelName = /mistral-large|zai-glm|kimi-k\d|deepseek-v\d|claude-(?:opus|sonnet|haiku)|gpt-\d|gemini-\d|glm-5/iu

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith(".ts") ? [path] : []
  })
}

describe("test suite independence from real providers", () => {
  it("uses synthetic providers and models instead of real ones", () => {
    const offenders = testFiles(testsRoot)
      .filter((file) => !allowed.has(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split(/\r?\n/u)
          .map((line, index) => ({ file, line, index }))
          .filter(({ line }) => realProviderReference.test(line) || realModelName.test(line))
          .map(({ file, line, index }) => `${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`)
      )

    assert.deepEqual(offenders, [], `Use tests/fixtures/models.ts instead of real providers or models:\n${offenders.join("\n")}`)
  })
})
