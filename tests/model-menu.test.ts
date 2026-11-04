import { PassThrough } from "node:stream"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildChoices, customChoice, promptNumbered, resolveAnswer } from "../scripts/model-menu.mjs"
import { models, ref } from "./fixtures/models.js"

const menuPath = join(process.cwd(), "scripts", "model-menu.mjs")

function runMenu(stdin: string, ...args: string[]) {
  return spawnSync(process.execPath, [menuPath, ...args], { input: stdin, encoding: "utf8" })
}

describe("installer model menu", () => {
  it("lists the default first, drops duplicates and invalid IDs, and ends with a custom entry", () => {
    assert.deepEqual(
      buildChoices(`${ref(models.withMax)}#max`, [ref(models.withMax), `${ref(models.noVariants)}\r`, "not a model", ref(models.noVariants), ""]),
      [`${ref(models.withMax)}#max`, ref(models.noVariants), customChoice]
    )
  })

  it("resolves empty answers, numbers, and typed model IDs", () => {
    const choices = ["a/b#max", "c/d", customChoice]

    assert.deepEqual(resolveAnswer("", choices), { choice: "a/b#max" })
    assert.deepEqual(resolveAnswer(" 2 ", choices), { choice: "c/d" })
    assert.deepEqual(resolveAnswer("e/f#max", choices), { choice: "e/f#max" })
    assert.ok(resolveAnswer("9", choices).error)
    assert.ok(resolveAnswer("nope", choices).error)
  })

  it("asks again after an invalid answer and supports the custom entry", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    input.end("7\n3\nbad id\nx/y\n")

    const choice = await promptNumbered({ prompt: "Pick", choices: ["a/b", "c/d", customChoice], input, output })

    assert.equal(choice, "x/y")
  })

  it("prints the selection on stdout when stdin is not a TTY", () => {
    const picked = runMenu("2\n", "Pick", "a/b#max", "c/d")
    const defaulted = runMenu("\n", "Pick", "a/b#max", "c/d")

    assert.equal(picked.status, 0, picked.stderr)
    assert.equal(picked.stdout, "c/d\n")
    assert.equal(defaulted.stdout, "a/b#max\n")
  })

  it("exits non-zero instead of choosing silently when input ends", () => {
    const ended = runMenu("", "Pick", "a/b#max")
    const usage = runMenu("", "Pick", "not-a-model")

    assert.equal(ended.status, 1)
    assert.equal(ended.stdout, "")
    assert.match(ended.stderr, /input ended/u)
    assert.equal(usage.status, 2)
  })
})
