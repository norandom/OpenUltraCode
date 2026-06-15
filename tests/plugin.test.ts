import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { OpenUltraCodePlugin } from "../src/index.js"

describe("OpenUltraCode plugin entry point", () => {
  it("returns no operational hooks when disabled", async () => {
    const hooks = await OpenUltraCodePlugin({ directory: await createProjectRoot() }, { enabled: false })

    assert.deepEqual(hooks, {})
  })

  it("loads in enabled mode without changing selected provider or model", async () => {
    const hooks = await OpenUltraCodePlugin({ directory: await createProjectRoot() }, { enabled: true })

    assert.equal("model" in hooks, false)
    assert.equal("provider" in hooks, false)
  })

  it("rejects invalid typed options with actionable configuration errors", async () => {
    await assert.rejects(
      () => OpenUltraCodePlugin({ directory: "/tmp/open-ultracode" }, { enabled: "yes" }),
      /enabled must be a boolean when provided/
    )
  })
})

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-ultracode-plugin-"))
}
