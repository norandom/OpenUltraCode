#!/usr/bin/env node
// Runtime check against the REAL opencode installation (not fakes, not copies):
//
//   node scripts/runtime-check.mjs --config-dir <dir> [--live]
//
// Static (free): opencode's live model list (`opencode api model.list`) must contain the
// coordinator model and every installed fusion agent's provider, model, and variant.
// Live (--live, a few tiny model calls): the coordinator dispatches each installed fusion agent
// once through opencode's real subagent path (`opencode run --format json`); every dispatch
// must complete, and the exported child session must show the configured model and variant.
//
// These are exactly the failures unit tests with fakes could not see: undeclared variants
// ("Variant unavailable"), providers missing from a running opencode, and 400 responses.

import { spawnSync } from "node:child_process"
import { mkdtempSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { getAgentModel, parseJsonc } from "./installer-lib.mjs"
import fs from "node:fs"

export const fusionAgents = ["ultracode-fusion-panel-a", "ultracode-fusion-panel-b", "ultracode-fusion-arbiter"]

/** Runs the opencode CLI; on Windows it is a .cmd shim, so a shell with a quoted command line is used. */
function runOpencode(args, { cwd = process.cwd(), timeoutMs = 300_000 } = {}) {
  // opencode takes its location from $PWD before the real working directory. Git hooks run
  // under sh, which exports PWD (the repository), so without this every check silently ran in
  // the repository and used its project agents instead of the installation being checked.
  const env = { ...process.env, PWD: cwd }
  const options = { cwd, env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }
  const result = process.platform === "win32"
    ? spawnSync(["opencode", ...args.map((arg) => `"${arg.replace(/"/gu, '\\"')}"`)].join(" "), { ...options, shell: true })
    : spawnSync("opencode", args, options)
  return { ok: result.error === undefined && result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** opencode's live model list; retried while plugins are still activating (HTTP 503). */
export function fetchModelList(run = runOpencode, { attempts = 8, delayMs = 5000 } = {}) {
  let last = ""
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run(["api", "model.list"])
    last = `${result.stdout}${result.stderr}`
    if (result.ok && !/ServiceUnavailable/u.test(last)) {
      const parsed = JSON.parse(result.stdout)
      return Array.isArray(parsed) ? parsed : parsed.data
    }
    if (attempt < attempts) sleep(delayMs)
  }
  throw new Error(`opencode api model.list failed: ${last.trim().split("\n")[0]}`)
}

/**
 * The coordinator model (`model` in opencode.json/jsonc) and the fusion agents' references as
 * opencode resolves them in `directory`: a project's `.opencode/agents` shadows the global
 * ones (the repository's shipped defaults shadow a developer's configuration this way).
 */
export function readInstalledModels(configDir, directory) {
  let coordinator
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = path.join(configDir, name)
    if (fs.existsSync(file)) {
      const config = parseJsonc(fs.readFileSync(file, "utf8"), file)
      if (typeof config.model === "string") coordinator ??= config.model
    }
  }
  const projectAgents = directory === undefined ? undefined : path.join(directory, ".opencode", "agents")
  const agentFile = (agent) => {
    const project = projectAgents === undefined ? undefined : path.join(projectAgents, `${agent}.md`)
    return project !== undefined && fs.existsSync(project) ? project : path.join(configDir, "agents", `${agent}.md`)
  }
  const agents = Object.fromEntries(fusionAgents.map((agent) => [agent, getAgentModel(agentFile(agent))]))
  const sources = Object.fromEntries(fusionAgents.map((agent) => [agent, agentFile(agent)]))
  return { coordinator, agents, sources }
}

function splitReference(reference) {
  const [base = "", variant] = reference.split("#")
  const slash = base.indexOf("/")
  return { providerID: base.slice(0, slash), modelID: base.slice(slash + 1), variant }
}

/** Static check: every reference must name a provider, model, and variant opencode currently offers. */
export function checkReferences(models, references) {
  const problems = []
  for (const [name, reference] of Object.entries(references)) {
    if (reference === undefined) {
      problems.push(`${name}: no model configured`)
      continue
    }
    const { providerID, modelID, variant } = splitReference(reference)
    const providerModels = models.filter((model) => model.providerID === providerID)
    const info = providerModels.find((model) => model.id === modelID || model.modelID === modelID)
    const variants = (info?.variants ?? []).map((entry) => entry.id)
    if (providerModels.length === 0) problems.push(`${name}: provider ${providerID} is not available in the running opencode (${reference})`)
    else if (info === undefined) problems.push(`${name}: opencode does not list ${providerID}/${modelID}`)
    else if (variant !== undefined && !variants.includes(variant)) {
      problems.push(`${name}: ${reference} selects variant "${variant}", but opencode reports ${variants.length === 0 ? "no variants" : variants.join(", ")} for it`)
    }
  }
  return problems
}

/** Parses `opencode run --format json` output into subagent dispatches and error events. */
export function parseRunEvents(output) {
  const subagents = []
  const errors = []
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim().startsWith("{")) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const part = event.part ?? {}
    if (event.type === "error" || event.error !== undefined) errors.push(JSON.stringify(event.error ?? event))
    if (part.type === "tool" && part.tool === "subagent") {
      const text = `${part.state?.output ?? ""}${part.state?.error ?? ""}`
      subagents.push({
        agent: part.state?.input?.agent,
        status: part.state?.status,
        childSessionID: part.state?.metadata?.sessionID ?? /sessionID="([^"]+)"/u.exec(text)?.[1],
        error: part.state?.status === "completed" ? undefined : String(part.state?.error ?? part.state?.output ?? "no output")
      })
    } else if (part.type === "tool" && part.state?.status === "error") {
      errors.push(`${part.tool}: ${String(part.state?.error ?? "")}`)
    }
  }
  return { subagents, errors }
}

/** A subagent session must have run on the configured model and variant and have succeeded. */
export function checkSubagentSession(agent, reference, exported) {
  const info = exported?.info ?? {}
  const expected = splitReference(reference)
  const actual = info.model ?? {}
  const expectedVariant = expected.variant ?? "default"
  const problems = []
  if (actual.providerID !== expected.providerID || actual.id !== expected.modelID) {
    problems.push(`${agent}: ran on ${actual.providerID}/${actual.id}, expected ${expected.providerID}/${expected.modelID}`)
  }
  if ((actual.variant ?? "default") !== expectedVariant) problems.push(`${agent}: ran with variant ${actual.variant ?? "default"}, expected ${expectedVariant}`)
  if (info.outcome !== "succeeded") problems.push(`${agent}: subagent outcome ${String(info.outcome)}`)
  return problems
}

function liveCheck(installed, log, directory) {
  const work = directory ?? mkdtempSync(path.join(os.tmpdir(), "open-ultracode-runtime-"))
  const prompt = `Use the subagent tool once for each of these agents, one after another: ${fusionAgents.join(", ")}. ` +
    "Give each the prompt: Reply with the single word OK. Do not retry, do not substitute agents or models, and do nothing else."
  log(`Live check: dispatching ${fusionAgents.join(", ")} through opencode (a few tiny model calls)...`)
  const modelArgs = installed.coordinator === undefined ? [] : ["--model", installed.coordinator]
  const result = runOpencode(["run", "--format", "json", ...modelArgs, prompt], { cwd: work, timeoutMs: 600_000 })
  const { subagents, errors } = parseRunEvents(result.stdout)
  const problems = errors.map((error) => `error event: ${error}`)
  if (!result.ok) problems.push(`opencode run failed: ${(result.stderr || String(result.error ?? "")).trim().split("\n").slice(-1)[0]}`)
  for (const agent of fusionAgents) {
    const dispatch = subagents.find((entry) => entry.agent === agent)
    const reference = installed.agents[agent]
    if (dispatch === undefined) {
      problems.push(`${agent}: was not dispatched by the coordinator`)
      continue
    }
    if (dispatch.status !== "completed") {
      problems.push(`${agent}: dispatch ${dispatch.status}: ${dispatch.error}`)
      continue
    }
    if (dispatch.childSessionID === undefined || reference === undefined) continue
    const exported = runOpencode(["session", "export", dispatch.childSessionID], { cwd: work })
    try {
      problems.push(...checkSubagentSession(agent, reference, JSON.parse(exported.stdout)))
    } catch {
      problems.push(`${agent}: could not export subagent session ${dispatch.childSessionID}`)
    }
  }
  return problems
}

export function runtimeCheck({ configDir, directory, live = false, log = console.log, fetchModels = fetchModelList }) {
  const installed = readInstalledModels(configDir, directory)
  const models = fetchModels()
  // Without a configured `model` opencode uses its own default, which is valid; only check one that is set.
  const coordinator = installed.coordinator === undefined ? {} : { coordinator: installed.coordinator }
  const problems = checkReferences(models, { ...coordinator, ...installed.agents })
  if (problems.length === 0 && live) problems.push(...liveCheck(installed, log, directory))
  return { installed, problems }
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const configDir = readOption(args, "--config-dir", process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode"))
  const directoryOption = readOption(args, "--directory", undefined)
  const directory = directoryOption === undefined ? undefined : path.resolve(directoryOption)
  try {
    const { installed, problems } = runtimeCheck({ configDir, directory, live: args.includes("--live") })
    console.log(`OpenUltraCode runtime check (${args.includes("--live") ? "static + live" : "static"}${directory === undefined ? "" : ` in ${directory}`}):`)
    console.log(`  coordinator      ${installed.coordinator ?? "opencode default (no model configured)"}`)
    for (const agent of fusionAgents) console.log(`  ${agent.padEnd(25)} ${installed.agents[agent] ?? "not set"}   (${installed.sources[agent]})`)
    if (problems.length === 0) {
      console.log("  result: OK")
    } else {
      for (const problem of problems) console.error(`  FAIL ${problem}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`OpenUltraCode runtime check could not run: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
