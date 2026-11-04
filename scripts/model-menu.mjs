#!/usr/bin/env node
// Interactive model picker for install.sh and install-dev.sh.
//
//   node scripts/model-menu.mjs <prompt> <default> [choice...]
//
// Prints the chosen "provider/model" or "provider/model#max" on stdout and exits 0.
// Exits 130 when cancelled (Ctrl+C, Esc, q) and 1 when input ends without a choice.
// With a raw-mode TTY it shows an arrow-key menu on stderr; otherwise (pipes, mintty,
// CI) it falls back to a numbered prompt that reads one line.

import { realpathSync } from "node:fs"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

export const customChoice = "Custom model ID"
export const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+(?:#max)?$/u

export function buildChoices(defaultModel, candidates) {
  const choices = [defaultModel]
  for (const candidate of candidates) {
    const model = candidate.trim()
    if (model.length > 0 && modelIdPattern.test(model) && !choices.includes(model) && !choices.includes(`${model}#max`)) {
      choices.push(model)
    }
  }
  choices.push(customChoice)
  return choices
}

/** Resolves a typed answer of the numbered prompt: empty = default, a number, or a model ID. */
export function resolveAnswer(answer, choices) {
  const text = answer.trim()
  if (text === "") return { choice: choices[0] }
  if (/^\d+$/u.test(text)) {
    const choice = choices[Number(text) - 1]
    return choice === undefined ? { error: `choose a number between 1 and ${choices.length}` } : { choice }
  }
  if (modelIdPattern.test(text)) return { choice: text }
  return { error: `${text} is not provider/model or provider/model#max` }
}

class Cancelled extends Error {}
class EndOfInput extends Error {}

function createLineReader(input, output) {
  const rl = readline.createInterface({ input, output, terminal: false })
  const lines = []
  const waiting = []
  let ended = false
  rl.on("line", (line) => {
    const next = waiting.shift()
    if (next) next.resolve(line)
    else lines.push(line)
  })
  rl.on("close", () => {
    ended = true
    for (const next of waiting.splice(0)) next.reject(new EndOfInput())
  })
  return {
    ask(question) {
      output.write(question)
      if (lines.length > 0) return Promise.resolve(lines.shift())
      if (ended) return Promise.reject(new EndOfInput())
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    },
    close: () => rl.close()
  }
}

async function askCustom(reader, output) {
  for (;;) {
    const answer = (await reader.ask("Enter provider/model or provider/model#max: ")).trim()
    if (modelIdPattern.test(answer)) return answer
    output.write(`Invalid model ID: ${answer}\n`)
  }
}

export async function promptNumbered({ prompt, choices, input, output }) {
  const reader = createLineReader(input, output)
  try {
    output.write(`${prompt}\n`)
    choices.forEach((choice, index) => output.write(`  ${index + 1}) ${choice}${index === 0 ? " (default)" : ""}\n`))
    for (;;) {
      const result = resolveAnswer(await reader.ask(`Select 1-${choices.length} or type a model ID [1]: `), choices)
      if (result.error !== undefined) {
        output.write(`${result.error}\n`)
        continue
      }
      return result.choice === customChoice ? await askCustom(reader, output) : result.choice
    }
  } finally {
    reader.close()
  }
}

function promptArrowKeys({ prompt, choices, input, output }) {
  return new Promise((resolve, reject) => {
    const n = choices.length
    const termWidth = output.columns || 80
    const colWidth = Math.max(12, Math.min(64, Math.max(...choices.map((c) => c.length)) + 4))
    const cols = Math.max(1, Math.floor(termWidth / colWidth))
    const rows = Math.ceil(n / cols)
    const visibleRows = Math.min(rows, Math.max(5, (output.rows || 24) - 4))
    let index = 0
    let offset = 0
    let rendered = 0

    const pad = (text) => (text.length > colWidth - 4 ? `${text.slice(0, colWidth - 7)}...` : text).padEnd(colWidth - 2)
    const render = () => {
      if (rendered > 0) output.write(`\x1b[${rendered}A`)
      const lines = [prompt]
      for (let r = 0; r < visibleRows; r += 1) {
        let line = ""
        for (let c = 0; c < cols; c += 1) {
          const i = c * rows + offset + r
          if (i < n) line += i === index ? `\x1b[7m${pad(choices[i])}\x1b[0m` : pad(choices[i])
        }
        lines.push(line.replace(/ +$/u, ""))
      }
      const above = offset
      const below = rows - offset - visibleRows
      lines.push(`  ${above > 0 ? `^ ${above} more above   ` : ""}${below > 0 ? `v ${below} more below` : ""}`)
      output.write(lines.map((l) => `\x1b[2K${l}\n`).join(""))
      rendered = lines.length
    }
    const move = (delta) => {
      index = (((index + delta) % n) + n) % n
      const row = index % rows
      if (row < offset) offset = row
      if (row >= offset + visibleRows) offset = row - visibleRows + 1
      render()
    }
    const finish = (error, value) => {
      input.off("keypress", onKey)
      input.off("end", onEnd)
      input.setRawMode(false)
      input.pause()
      output.write("\x1b[?25h")
      if (error) reject(error)
      else resolve(value)
    }
    const onEnd = () => finish(new EndOfInput())
    const onKey = (_str, key) => {
      if (!key) return
      if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") finish(new Cancelled())
      else if (key.name === "up") move(-1)
      else if (key.name === "down") move(1)
      else if (key.name === "left") move(-rows)
      else if (key.name === "right") move(rows)
      else if (key.name === "return" || key.name === "enter") finish(undefined, choices[index])
    }

    readline.emitKeypressEvents(input)
    input.setRawMode(true)
    input.resume()
    input.on("keypress", onKey)
    input.on("end", onEnd)
    output.write("\x1b[?25l")
    render()
  })
}

export async function selectModel({ prompt, defaultModel, candidates, input = process.stdin, output = process.stderr }) {
  const choices = buildChoices(defaultModel, candidates)
  if (input.isTTY && typeof input.setRawMode === "function") {
    const picked = await promptArrowKeys({ prompt, choices, input, output })
    return picked === customChoice ? askCustomStandalone(input, output) : picked
  }
  return promptNumbered({ prompt, choices, input, output })
}

async function askCustomStandalone(input, output) {
  const reader = createLineReader(input, output)
  try {
    return await askCustom(reader, output)
  } finally {
    reader.close()
  }
}

async function main(argv) {
  const [prompt, defaultModel, ...candidates] = argv
  if (prompt === undefined || defaultModel === undefined || !modelIdPattern.test(defaultModel)) {
    process.stderr.write("usage: model-menu.mjs <prompt> <default provider/model[#max]> [choice...]\n")
    return 2
  }
  // Restore the cursor even when the process is killed while the menu is shown.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      process.stderr.write("\x1b[?25h")
      process.exit(130)
    })
  }
  try {
    process.stdout.write(`${await selectModel({ prompt, defaultModel, candidates })}\n`)
    return 0
  } catch (error) {
    if (error instanceof Cancelled) {
      process.stderr.write("Installation cancelled.\n")
      return 130
    }
    if (error instanceof EndOfInput) {
      process.stderr.write("No model selected: input ended.\n")
      return 1
    }
    throw error
  }
}

// Compare real paths: argv[1] keeps symlinks (macOS /var -> /private/var) that import.meta.url resolves.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
