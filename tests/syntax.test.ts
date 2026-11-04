import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Syntax checks with every checker that is installed: sh, dash, shellcheck, pwsh 7, and
// Windows PowerShell 5.1. Missing checkers are reported as skipped, never as passed.

const shellScripts = ["install.sh", "install-dev.sh", ".githooks/pre-commit", ".githooks/pre-push"]
const powershellScripts = ["install.ps1", "install-dev.ps1"]

function available(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 })
  return result.error === undefined && result.status === 0
}

const parsePowerShell =
  "$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $env:CHECK_SYNTAX_FILE), [ref]$null, [ref]$errors); " +
  "if ($errors) { $errors | ForEach-Object { Write-Host \"$($_.Extent.StartLineNumber): $($_.Message)\" }; exit 1 }"

const checkers = [
  { name: "sh -n", available: available("sh", ["-c", "exit 0"]), files: shellScripts, run: (file: string) => spawnSync("sh", ["-n", file], { encoding: "utf8" }) },
  { name: "dash -n", available: available("dash", ["-c", "exit 0"]), files: shellScripts, run: (file: string) => spawnSync("dash", ["-n", file], { encoding: "utf8" }) },
  {
    name: "shellcheck",
    available: available("shellcheck", ["--version"]),
    files: shellScripts,
    run: (file: string) => spawnSync("shellcheck", ["--shell=sh", "--severity=warning", file], { encoding: "utf8" })
  },
  ...["pwsh", "powershell.exe"].map((shell) => ({
    name: `${shell} parser`,
    available: (shell === "pwsh" || process.platform === "win32") && available(shell, ["-NoProfile", "-Command", "exit 0"]),
    files: powershellScripts,
    // -Command does not bind trailing arguments to $args, so the path travels in the environment.
    run: (file: string) =>
      spawnSync(shell, ["-NoProfile", "-Command", parsePowerShell], { encoding: "utf8", env: { ...process.env, CHECK_SYNTAX_FILE: file } })
  }))
]

describe("installer syntax", () => {
  for (const checker of checkers) {
    describe(checker.name, { skip: !checker.available && `${checker.name} is not installed` }, () => {
      for (const file of checker.files) {
        it(file, () => {
          const result = checker.run(file)
          assert.equal(result.error, undefined, String(result.error))
          assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
        })
      }

      it("rejects a broken script", () => {
        const broken = join(mkdtempSync(join(tmpdir(), "open-ultracode-syntax-")), checker.files === shellScripts ? "broken.sh" : "broken.ps1")
        writeFileSync(broken, checker.files === shellScripts ? "if true; then\n" : "function Broken {\n")
        assert.notEqual(checker.run(broken).status, 0, `${checker.name} accepted a broken script`)
      })
    })
  }
})
