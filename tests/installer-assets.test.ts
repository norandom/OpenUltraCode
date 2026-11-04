import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { describe, it } from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"

import { validateInstallers } from "../scripts/validate-installers.js"

const projectRoot = process.cwd()

describe("OpenUltraCode installer guard rails", () => {
  it("validates the project installers", () => {
    const result = validateInstallers(projectRoot)

    assert.equal(result.ok, true, result.errors.join("\n"))
  })

  const regressions: ReadonlyArray<{ name: string; file: string; from: string | RegExp; to: string; error: RegExp }> = [
    {
      name: "inline config edits that delete foreign plugins",
      file: "install.sh",
      from: "lib register",
      to: "node -e 'delete config.plugin' && lib register",
      error: /install\.sh must not edit opencode config inline/u
    },
    {
      name: "a single-file V1 plugin registration",
      file: "install-dev.sh",
      from: "/.opencode/plugins/open-ultracode\"",
      to: "/.opencode/plugins/open-ultracode.ts\"",
      error: /install-dev\.sh must register the \.opencode\/plugins\/open-ultracode directory/u
    },
    {
      name: "a swallowed menu failure in bash",
      file: "install.sh",
      from: /model=\$\(choose_model ([^\n]*)\) \|\| exit \$\?/u,
      to: "model=$(choose_model $1)",
      error: /install\.sh must propagate failures/u
    },
    {
      name: "a native command whose exit code is ignored",
      file: "install-dev.ps1",
      from: "Invoke-Native \"pnpm run check\" { pnpm run check }",
      to: "pnpm run check",
      error: /install-dev\.ps1 must (?:run native commands through Invoke-Native|not call pnpm)/u
    },
    {
      name: "exit in the irm | iex installer",
      file: "install.ps1",
      from: /^ {2}return(\r?\n)\}/mu,
      to: "  exit 0$1}",
      error: /install\.ps1 must throw instead of calling exit/u
    },
    {
      name: "a literal \\n written by Set-Content",
      file: "install-dev.ps1",
      from: "function Enable-GitHooks {",
      to: "\"{\\n}\" | Set-Content -Path $configFile\r\nfunction Enable-GitHooks {",
      error: /must not write files with Set-Content/u
    },
    {
      name: "a PowerShell scope-qualifier interpolation bug",
      file: "install.ps1",
      from: "throw \"Could not download the latest OpenUltraCode release asset from ${releaseUrl}: $_\"",
      to: "throw \"Could not download the latest OpenUltraCode release asset from $releaseUrl: $_\"",
      error: /install\.ps1 contains "\$\.\.\.:"/u
    },
    {
      name: "non-ASCII characters in a PowerShell installer",
      file: "install.ps1",
      from: "# This script also runs",
      to: "# This script – also runs",
      error: /install\.ps1 must contain only ASCII/u
    },
    {
      name: "a shipped asset list that drifted from .opencode",
      file: "install-dev.sh",
      from: "ultrathink.md\"",
      to: "\"",
      error: /install-dev\.sh shipped commands list is out of sync/u
    },
    {
      name: "a missing removal option",
      file: "install-dev.ps1",
      from: "[switch]$Remove",
      to: "[switch]$Skipped",
      error: /install-dev\.ps1 must expose removal/u
    }
  ]

  for (const regression of regressions) {
    it(`rejects ${regression.name}`, () => {
      const root = copyProject()
      const path = join(root, regression.file)
      const original = readFileSync(path, "utf8")
      const changed = original.replace(regression.from, regression.to)
      assert.notEqual(changed, original, `fixture for "${regression.name}" no longer matches ${regression.file}`)
      writeFileSync(path, changed)

      const result = validateInstallers(root)

      assert.equal(result.ok, false)
      assert.match(result.errors.join("\n"), regression.error)
    })
  }
})

function copyProject(): string {
  const root = mkdtempSync(join(tmpdir(), "open-ultracode-installers-"))
  for (const name of ["install.sh", "install-dev.sh", "install.ps1", "install-dev.ps1"]) {
    cpSync(join(projectRoot, name), join(root, name))
  }
  cpSync(join(projectRoot, ".opencode", "commands"), join(root, ".opencode", "commands"), { recursive: true })
  cpSync(join(projectRoot, "assets", "agents"), join(root, "assets", "agents"), { recursive: true })
  return root
}
