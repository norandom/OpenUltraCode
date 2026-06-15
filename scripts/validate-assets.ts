import { existsSync } from "node:fs"
import { join } from "node:path"

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

const missingPaths = requiredScaffoldPaths.filter(
  (relativePath) => !existsSync(join(process.cwd(), relativePath))
)

if (missingPaths.length > 0) {
  console.error(`Missing OpenUltraCode scaffold paths:\n${missingPaths.join("\n")}`)
  process.exitCode = 1
} else {
  console.log("OpenUltraCode scaffold paths are present")
}
