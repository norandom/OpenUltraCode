#!/usr/bin/env node
// Shared, dependency-free helpers for install.sh, install-dev.sh, install.ps1 and
// install-dev.ps1. The installers only orchestrate; every edit of opencode config
// and agent files happens here so it can be tested with fixtures (tests/installer-lib.test.ts).
//
// Usage:
//   node scripts/installer-lib.mjs register --config-dir <dir> --plugin-path <dir>
//   node scripts/installer-lib.mjs unregister --config-dir <dir>
//   node scripts/installer-lib.mjs get-agent-model <agent.md>
//   node scripts/installer-lib.mjs set-agent-model <agent.md> <provider/model[#max]>
//   node scripts/installer-lib.mjs validate-model <provider/model[#max]>
//   node scripts/installer-lib.mjs list-models --config-dir <dir>
//   node scripts/installer-lib.mjs summary --config-dir <dir> --source-dir <dir>

import { spawnSync } from "node:child_process"
import fs, { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const schemaUrl = "https://opencode.ai/config.json"
export const fusionPermissionAction = "open_ultracode_configure_fusion"
export const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+(?:#max)?$/u

const pluginMarker = "/.opencode/plugins/open-ultracode"
const legacyFusionPlaceholders = new Set(["provider/model-a", "provider/model-b", "provider/arbiter-model"])

export class InstallerError extends Error {}

/** Removes comments and trailing commas outside of strings, plus a leading BOM. */
export function parseJsonc(text, source = "config") {
  const withoutBom = text.replace(/^\uFEFF/u, "")
  let stripped = ""
  let i = 0
  while (i < withoutBom.length) {
    const char = withoutBom[i]
    const next = withoutBom[i + 1]
    if (char === "\"") {
      let j = i + 1
      while (j < withoutBom.length && withoutBom[j] !== "\"") j += withoutBom[j] === "\\" ? 2 : 1
      stripped += withoutBom.slice(i, j + 1)
      i = j + 1
    } else if (char === "/" && next === "/") {
      const end = withoutBom.indexOf("\n", i)
      i = end === -1 ? withoutBom.length : end
    } else if (char === "/" && next === "*") {
      const end = withoutBom.indexOf("*/", i + 2)
      i = end === -1 ? withoutBom.length : end + 2
    } else if (char === "," && /^\s*[}\]]/u.test(withoutBom.slice(i + 1))) {
      i += 1
    } else {
      stripped += char
      i += 1
    }
  }

  let value
  try {
    value = JSON.parse(stripped)
  } catch (error) {
    throw new InstallerError(`Could not parse ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstallerError(`${source} must contain a JSON object`)
  }
  return value
}

/**
 * Normalizes a plugin directory for opencode on the current platform. Git Bash and
 * MSYS shells may hand over "/c/Users/..." which native Windows programs misread.
 */
export function normalizePluginPath(value, platform = process.platform) {
  let candidate = value
  if (platform === "win32") {
    const msys = /^\/([A-Za-z])(\/.*)?$/u.exec(candidate)
    if (msys !== null) candidate = `${msys[1].toUpperCase()}:${msys[2] ?? "/"}`
    return path.win32.resolve(candidate).replace(/\\/gu, "/")
  }
  return path.posix.resolve(candidate)
}

export function isOpenUltraCodePluginEntry(entry) {
  const value = typeof entry === "string"
    ? entry
    : entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.package === "string"
      ? entry.package
      : undefined
  if (value === undefined) return false
  const normalized = value.replace(/\\/gu, "/")
  return normalized.endsWith(pluginMarker) || normalized.endsWith(`${pluginMarker}/`) ||
    normalized.endsWith(`${pluginMarker}.ts`) || normalized.endsWith(`${pluginMarker}/index.ts`)
}

function isFusionPermissionRule(entry) {
  return entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.action === fusionPermissionAction
}

/** Removes every OpenUltraCode plugin entry and permission rule; leaves all foreign entries untouched. */
export function withoutOpenUltraCode(config) {
  const result = { ...config }
  for (const key of ["plugins", "plugin"]) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].filter((entry) => !isOpenUltraCodePluginEntry(entry))
      if (result[key].length === 0 && Array.isArray(config[key]) && config[key].length > 0) delete result[key]
    }
  }
  if (Array.isArray(result.permissions)) {
    result.permissions = result.permissions.filter((entry) => !isFusionPermissionRule(entry))
    if (result.permissions.length === 0 && Array.isArray(config.permissions) && config.permissions.length > 0) {
      delete result.permissions
    }
  }
  if (result.permission !== null && typeof result.permission === "object" && !Array.isArray(result.permission) &&
    fusionPermissionAction in result.permission) {
    const { [fusionPermissionAction]: _removed, ...rest } = result.permission
    result.permission = rest
  }
  return result
}

/** Adds exactly one OpenUltraCode plugin entry and the fusion "ask" rule. */
export function withOpenUltraCode(config, pluginPath) {
  const result = withoutOpenUltraCode(config)
  result.$schema ??= schemaUrl
  result.plugins = [...(Array.isArray(result.plugins) ? result.plugins : []), { package: pluginPath }]
  result.permissions = [
    ...(Array.isArray(result.permissions) ? result.permissions : []),
    { action: fusionPermissionAction, resource: "*", effect: "ask" }
  ]
  return result
}

function readConfig(file) {
  if (!fs.existsSync(file)) return undefined
  return parseJsonc(fs.readFileSync(file, "utf8"), file)
}

function writeFileAtomically(file, content) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, content, { flag: "w" })
  fs.renameSync(temp, file)
}

/** Writes config when it changed, keeping a timestamped backup of the previous file. */
function writeConfig(file, before, after, log) {
  if (before !== undefined && JSON.stringify(before) === JSON.stringify(after)) return false
  if (fs.existsSync(file)) {
    const backup = `${file}.backup-openultracode-${new Date().toISOString().replace(/[:.]/gu, "-")}`
    fs.copyFileSync(file, backup)
    log(`OpenUltraCode: updated ${file} (backup: ${backup})`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomically(file, `${JSON.stringify(after, null, 2)}\n`)
  return true
}

/**
 * opencode merges opencode.json and opencode.jsonc from the config directory. The plugin
 * is registered in opencode.json only; OpenUltraCode entries in opencode.jsonc are pruned
 * so stale paths from older releases cannot fail plugin loading.
 */
export function registerPlugin({ configDir, pluginPath, log = () => {} }) {
  const jsonFile = path.join(configDir, "opencode.json")
  const jsoncFile = path.join(configDir, "opencode.jsonc")
  const normalizedPath = normalizePluginPath(pluginPath)
  // Parse both files before writing either so a bad file leaves everything unchanged.
  const json = readConfig(jsonFile)
  const jsonc = readConfig(jsoncFile)

  writeConfig(jsonFile, json, withOpenUltraCode(json ?? {}, normalizedPath), log)
  if (jsonc !== undefined) writeConfig(jsoncFile, jsonc, withoutOpenUltraCode(jsonc), log)
  return normalizedPath
}

export function unregisterPlugin({ configDir, log = () => {} }) {
  const files = [path.join(configDir, "opencode.json"), path.join(configDir, "opencode.jsonc")]
  const configs = files.map(readConfig)
  files.forEach((file, index) => {
    const config = configs[index]
    if (config !== undefined) writeConfig(file, config, withoutOpenUltraCode(config), log)
  })
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** Returns the configured "provider/model#max" of a fusion agent, or undefined for placeholders. */
export function getAgentModel(file) {
  if (!fs.existsSync(file)) return undefined
  const frontmatter = frontmatterPattern.exec(fs.readFileSync(file, "utf8"))?.[1]
  const model = frontmatter === undefined ? undefined : /^model:[ \t]*(\S+)[ \t]*\r?$/mu.exec(frontmatter)?.[1]
  const baseModel = model?.replace(/#[^#]+$/u, "")
  if (baseModel === undefined || legacyFusionPlaceholders.has(baseModel)) return undefined
  return `${baseModel}#max`
}

export function assertModelId(model) {
  if (typeof model !== "string" || !modelIdPattern.test(model)) {
    throw new InstallerError(`${String(model)} must be provider/model or provider/model#max`)
  }
}

/** Sets model and "variant: max" inside the frontmatter only, keeping the file's line endings. */
export function setAgentModel(file, model) {
  assertModelId(model)
  if (!fs.existsSync(file)) throw new InstallerError(`Missing fusion agent file: ${file}`)
  const content = fs.readFileSync(file, "utf8")
  const match = frontmatterPattern.exec(content)
  if (match === null || !/^model:/mu.test(match[1])) throw new InstallerError(`${file} does not contain model frontmatter`)

  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const baseModel = model.replace(/#[^#]+$/u, "")
  let frontmatter = match[1].replace(/^model:.*?(\r?)$/mu, `model: ${baseModel}$1`)
  frontmatter = /^variant:/mu.test(frontmatter)
    ? frontmatter.replace(/^variant:.*?(\r?)$/mu, "variant: max$1")
    : frontmatter.replace(/^(model:.*?)(\r?)$/mu, (_line, body, cr) => cr === "" ? `${body}${eol}variant: max` : `${body}\r\nvariant: max\r`)

  const start = match[0].indexOf(match[1])
  const updated = content.slice(0, start) + frontmatter + content.slice(start + match[1].length)
  if (updated !== content) writeFileAtomically(file, updated)
}

/** Providers of opencode's own hosted catalog; listed after the user's providers. */
export const catalogProviders = new Set(["opencode", "opencode-go"])
const plainModelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+$/u

/** Reads `provider/model` lines from `opencode models` output. */
export function parseModelList(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => plainModelIdPattern.test(line))
}

/** Model IDs the user configured: `model`, `small_model`, and `provider.<id>.models.<id>`. */
export function configuredModels(config) {
  const models = []
  for (const key of ["model", "small_model"]) {
    if (typeof config[key] === "string") models.push(config[key].replace(/#[^#]+$/u, ""))
  }
  const providers = config.provider !== null && typeof config.provider === "object" ? config.provider : {}
  for (const [providerID, provider] of Object.entries(providers)) {
    const entries = provider !== null && typeof provider === "object" ? provider.models : undefined
    if (entries !== null && typeof entries === "object") {
      for (const modelID of Object.keys(entries)) models.push(`${providerID}/${modelID}`)
    }
  }
  return models.filter((model) => plainModelIdPattern.test(model))
}

/** Removes duplicates and lists the user's own providers before opencode's hosted catalog. */
export function orderModels(models) {
  const unique = [...new Set(models)]
  const isCatalog = (model) => catalogProviders.has(model.slice(0, model.indexOf("/")))
  return [...unique.filter((model) => !isCatalog(model)), ...unique.filter(isCatalog)]
}

function runOpencodeModels() {
  // stdin is ignored: under `curl | sh` it is the installer script itself.
  const options = { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] }
  // On Windows opencode is a .cmd shim, which needs a shell; a fixed command string avoids
  // passing arguments through the shell (DEP0190).
  const result = process.platform === "win32"
    ? spawnSync("opencode models", { ...options, shell: true })
    : spawnSync("opencode", ["models"], options)
  return { ok: result.error === undefined && result.status === 0, stdout: result.stdout ?? "" }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Lists the model IDs offered in the installer menu: the user's configured models plus
 * everything `opencode models` reports, with the user's providers first. `opencode models`
 * fails while plugins are still activating ("Location plugins did not finish activating"),
 * so it is retried; configured models are offered even when it never succeeds.
 */
export function listModels({ configDir, run = runOpencodeModels, attempts = 3, delayMs = 2000 }) {
  const configured = []
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    try {
      const config = readConfig(path.join(configDir, name))
      if (config !== undefined) configured.push(...configuredModels(config))
    } catch {
      // A broken config file must not hide the detected models; register reports it.
    }
  }

  let detected = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run()
    if (result.ok) {
      detected = parseModelList(result.stdout)
      break
    }
    if (attempt < attempts) sleep(delayMs)
  }
  return orderModels([...configured, ...detected])
}

const fusionRoles = [
  ["Fusion panel A", "ultracode-fusion-panel-a.md"],
  ["Fusion panel B", "ultracode-fusion-panel-b.md"],
  ["Fusion arbiter", "ultracode-fusion-arbiter.md"]
]

/**
 * Describes what is installed, read back from disk after the install, so the summary shows
 * the real result (registered plugin entry, fusion models, assets) rather than the intent.
 */
export function installSummary({ configDir, sourceDir }) {
  let version = "unknown"
  try {
    version = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8")).version ?? version
  } catch {
    // Keep "unknown"; the rest of the summary is still accurate.
  }
  const configFile = path.join(configDir, "opencode.json")
  const config = readConfig(configFile) ?? {}
  const entries = [...(Array.isArray(config.plugins) ? config.plugins : []), ...(Array.isArray(config.plugin) ? config.plugin : [])]
    .filter(isOpenUltraCodePluginEntry)
    .map((entry) => (typeof entry === "string" ? entry : entry.package))
  const shipped = (kind) => fs.existsSync(path.join(sourceDir, ".opencode", kind))
    ? fs.readdirSync(path.join(sourceDir, ".opencode", kind)).filter((name) => name.endsWith(".md") && fs.existsSync(path.join(configDir, kind, name)))
    : []
  const commands = shipped("commands").map((name) => `/${name.replace(/\.md$/u, "")}`)

  return [
    `OpenUltraCode ${version} installed`,
    `  Source:          ${sourceDir}`,
    `  Plugin entry:    ${entries.length === 1 ? entries[0] : `${entries.length} entries (expected 1): ${entries.join(", ")}`}`,
    `  OpenCode config: ${configFile}`,
    ...fusionRoles.map(([label, file]) => `  ${`${label}:`.padEnd(16)} ${getAgentModel(path.join(configDir, "agents", file))?.replace(/#max$/u, " (variant max)") ?? "not set"}`),
    `  Commands:        ${commands.length > 0 ? commands.join(" ") : "none"}`,
    `  Agents:          ${shipped("agents").length} installed in ${path.join(configDir, "agents")}`,
    "Restart opencode to load the plugin, commands, skills, and agents."
  ]
}

function readOption(args, name) {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith("--")) throw new InstallerError(`missing ${name} <value>`)
  return value
}

export function main(argv, log = console.log) {
  const [command, ...args] = argv
  switch (command) {
    case "register":
      registerPlugin({ configDir: readOption(args, "--config-dir"), pluginPath: readOption(args, "--plugin-path"), log })
      return
    case "unregister":
      unregisterPlugin({ configDir: readOption(args, "--config-dir"), log })
      return
    case "get-agent-model": {
      const model = getAgentModel(args[0] ?? "")
      if (model !== undefined) process.stdout.write(model)
      return
    }
    case "set-agent-model":
      setAgentModel(args[0] ?? "", args[1])
      return
    case "validate-model":
      assertModelId(args[0])
      return
    case "summary":
      for (const line of installSummary({ configDir: readOption(args, "--config-dir"), sourceDir: readOption(args, "--source-dir") })) log(line)
      return
    case "list-models":
      for (const model of listModels({ configDir: readOption(args, "--config-dir") })) log(model)
      return
    default:
      throw new InstallerError(`unknown command: ${String(command)}`)
  }
}

// Compare real paths: argv[1] keeps symlinks (macOS /var -> /private/var) that import.meta.url resolves.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof InstallerError)) throw error
    console.error(`OpenUltraCode installer: ${error.message}`)
    process.exitCode = 1
  }
}
