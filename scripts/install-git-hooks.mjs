// Runs as the `prepare` script on `pnpm install`: points git at the versioned hooks in
// .githooks so every contributor gets the pre-commit gate. Silently does nothing outside
// a git checkout (for example in an extracted release archive) or when git is missing.
import { spawnSync } from "node:child_process"

const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })
if (inside.status === 0 && inside.stdout.trim() === "true") {
  const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" })
  if (result.status !== 0) console.warn("OpenUltraCode: could not set core.hooksPath to .githooks")
}
