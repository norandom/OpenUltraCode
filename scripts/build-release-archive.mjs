#!/usr/bin/env node
// Builds the release archive that install.sh and install.ps1 download:
//
//   node scripts/build-release-archive.mjs [out.tar.gz]
//
// releaseFiles is the single list of shipped paths; .github/workflows/release.yml and the
// installer tests use this script, so the archive cannot drift from what the installers need.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const releaseFiles = [
  ".opencode/agents",
  ".opencode/commands",
  ".opencode/lib",
  ".opencode/plugins",
  ".opencode/skills",
  "src",
  "scripts/installer-lib.mjs",
  "scripts/model-menu.mjs",
  "docs",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "opencode.json",
  "package.json",
  "tsconfig.json",
  "install.sh",
  "install.ps1"
]

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Windows ships bsdtar as System32\tar.exe; Git's GNU tar on PATH misreads "C:" paths. */
function tarCommand() {
  const windowsTar = process.env.SystemRoot === undefined ? undefined : path.join(process.env.SystemRoot, "System32", "tar.exe")
  return windowsTar !== undefined && existsSync(windowsTar) ? windowsTar : "tar"
}

export function buildReleaseArchive(out) {
  const missing = releaseFiles.filter((file) => !existsSync(path.join(repoRoot, file)))
  if (missing.length > 0) throw new Error(`release files are missing: ${missing.join(", ")}`)

  const result = spawnSync(tarCommand(), ["-czf", path.resolve(out), ...releaseFiles], { cwd: repoRoot, encoding: "utf8" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`tar failed with exit code ${result.status}: ${result.stderr}`)
  return path.resolve(out)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(buildReleaseArchive(process.argv[2] ?? "open-ultracode-release.tar.gz"))
}
