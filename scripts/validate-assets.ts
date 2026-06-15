import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

export interface AssetValidationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
}

interface FrontmatterDocument {
  readonly frontmatter: ReadonlyMap<string, string>
  readonly frontmatterSource: string
  readonly body: string
}

const requiredScaffoldPaths = [
  "package.json",
  "tsconfig.json",
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

const requiredCommandAssets = [
  "ultracode.md",
  "ultracode-debug.md",
  "ultracode-spec-audit.md",
  "ultracode-research.md",
  "ultracode-verify.md"
] as const

const requiredAgentAssets = [
  "open-ultracode.md",
  "open-ultracode-planner.md",
  "open-ultracode-implementer.md",
  "open-ultracode-adversary.md",
  "open-ultracode-reconciler.md",
  "open-ultracode-verifier.md",
  "open-ultracode-researcher.md"
] as const

export function validateAssets(root = process.cwd()): AssetValidationResult {
  const errors: string[] = []

  for (const relativePath of requiredScaffoldPaths) {
    if (!existsSync(join(root, relativePath))) {
      errors.push(`${relativePath} is missing`)
    }
  }

  validatePlugin(root, errors)
  validateSkill(root, errors)
  validateCommands(root, errors)
  validateAgents(root, errors)

  return { ok: errors.length === 0, errors }
}

function validatePlugin(root: string, errors: string[]): void {
  const relativePath = ".opencode/plugins/open-ultracode.ts"
  const content = readAsset(root, relativePath, errors)
  if (content === undefined) return
  if (!/export\s+\{[^}]*default[^}]*\}|export\s+default/.test(content)) {
    errors.push(`${relativePath} must export an opencode plugin entry point`)
  }
  if (/\b(model|provider)\s*:/.test(content)) {
    errors.push(`${relativePath} must not configure model or provider routing`)
  }
}

function validateSkill(root: string, errors: string[]): void {
  const relativePath = ".opencode/skills/open-ultracode/SKILL.md"
  const document = readFrontmatter(root, relativePath, errors)
  if (document === undefined) return

  if (document.frontmatter.get("name") !== "open-ultracode") {
    errors.push(`${relativePath} frontmatter must set name: open-ultracode`)
  }
  if (!document.frontmatter.has("description")) {
    errors.push(`${relativePath} frontmatter must include description`)
  }
  requireBody(relativePath, document.body, [/selected model/i, /verification/i, /missing task context|incomplete spec/i], errors)
  rejectModelOverride(relativePath, document, errors)
}

function validateCommands(root: string, errors: string[]): void {
  for (const fileName of requiredCommandAssets) {
    const relativePath = `.opencode/commands/${fileName}`
    const document = readFrontmatter(root, relativePath, errors)
    if (document === undefined) continue

    if (!document.frontmatter.has("description")) {
      errors.push(`${relativePath} frontmatter must include description`)
    }
    rejectModelOverride(relativePath, document, errors)
    requireBody(relativePath, document.body, [/\$ARGUMENTS/, /selected model/i, /Workflow mode:/i], errors)
    if (!/missing task context|not provide enough task context/i.test(document.body)) {
      errors.push(`${relativePath} must ask focused questions when task context is missing`)
    }
  }
}

function validateAgents(root: string, errors: string[]): void {
  for (const fileName of requiredAgentAssets) {
    const relativePath = `.opencode/agents/${fileName}`
    const document = readFrontmatter(root, relativePath, errors)
    if (document === undefined) continue

    if (!document.frontmatter.has("description")) {
      errors.push(`${relativePath} frontmatter must include description`)
    }
    if (document.frontmatter.get("mode") !== "subagent") {
      errors.push(`${relativePath} frontmatter must set mode: subagent`)
    }
    rejectModelOverride(relativePath, document, errors)
    validateAgentPermissions(relativePath, document, errors)
    requireBody(relativePath, document.body, [/inherit the active selected model/i, /do not change provider/i, /structured output/i], errors)
  }
}

function validateAgentPermissions(relativePath: string, document: FrontmatterDocument, errors: string[]): void {
  if (!document.frontmatter.has("permission")) {
    errors.push(`${relativePath} frontmatter must include permission constraints`)
    return
  }
  if (document.frontmatter.get("permission") === "allow") {
    errors.push(`${relativePath} permission must not allow all tools`)
  }

  const permissionBlock = readFrontmatterBlock(document, "permission")
  if (/\bedit\s*:\s*allow\b/i.test(permissionBlock)) {
    errors.push(`${relativePath} permission must not set edit: allow`)
  }
  if (/\bbash\s*:\s*allow\b/i.test(permissionBlock)) {
    errors.push(`${relativePath} permission must not set bash: allow`)
  }
  if (/\bpermission\s*:\s*allow\b/i.test(permissionBlock)) {
    errors.push(`${relativePath} permission must not allow all tools`)
  }
}

function readAsset(root: string, relativePath: string, errors: string[]): string | undefined {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) {
    errors.push(`${relativePath} is missing`)
    return undefined
  }
  return readFileSync(fullPath, "utf8")
}

function readFrontmatter(root: string, relativePath: string, errors: string[]): FrontmatterDocument | undefined {
  const content = readAsset(root, relativePath, errors)
  if (content === undefined) return undefined

  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(content)
  if (match === null) {
    errors.push(`${relativePath} must include YAML frontmatter`)
    return undefined
  }
  const frontmatterSource = match[1]
  const body = match[2]
  if (frontmatterSource === undefined || body === undefined) {
    errors.push(`${relativePath} frontmatter could not be parsed`)
    return undefined
  }

  return {
    frontmatter: parseFrontmatter(frontmatterSource),
    frontmatterSource,
    body
  }
}

function parseFrontmatter(frontmatter: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  for (const line of frontmatter.split("\n")) {
    const match = /^(\w[\w-]*)\s*:\s*(.*)$/u.exec(line)
    if (match !== null) {
      const key = match[1]
      const value = match[2]
      if (key !== undefined && value !== undefined) {
        values.set(key, value)
      }
    }
  }
  return values
}

function readFrontmatterBlock(document: FrontmatterDocument, key: string): string {
  if (document.frontmatter.has(key)) {
    const match = new RegExp(`(^|\\n)${key}:([\\s\\S]*?)(\\n\\w[\\w-]*\\s*:|$)`, "u").exec(
      document.frontmatterSource
    )
    return match?.[2] ?? document.frontmatter.get(key) ?? ""
  }
  return ""
}

function rejectModelOverride(relativePath: string, document: FrontmatterDocument, errors: string[]): void {
  if (document.frontmatter.has("model")) {
    errors.push(`${relativePath} frontmatter must not include model overrides`)
  }
  if (/override the selected model/i.test(document.body)) {
    errors.push(`${relativePath} must not instruct users to override the selected model`)
  }
}

function requireBody(relativePath: string, body: string, patterns: readonly RegExp[], errors: string[]): void {
  for (const pattern of patterns) {
    if (!pattern.test(body)) {
      errors.push(`${relativePath} body is missing required guidance matching ${pattern}`)
    }
  }
}

if (isDirectExecution()) {
  const result = validateAssets()
  if (result.ok) {
    console.log("OpenUltraCode assets are valid")
  } else {
    console.error(`OpenUltraCode asset validation failed:\n${result.errors.join("\n")}`)
    process.exitCode = 1
  }
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1]
  return scriptPath !== undefined && basename(scriptPath) === basename(new URL(import.meta.url).pathname)
}
