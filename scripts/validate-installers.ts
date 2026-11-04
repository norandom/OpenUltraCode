import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

export interface InstallerValidationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
}

// Static guard rails for the four installers. Behavior is covered by tests/installer-lib.test.ts
// (config editing) and tests/installer-e2e.test.ts (real installer runs); these rules catch
// regressions those tests cannot see, such as a check that only fails on another platform.

const shellInstallers = ["install.sh", "install-dev.sh"] as const
const powershellInstallers = ["install.ps1", "install-dev.ps1"] as const
const allInstallers = [...shellInstallers, ...powershellInstallers] as const
const fusionAgents = ["ultracode-fusion-panel-a.md", "ultracode-fusion-panel-b.md", "ultracode-fusion-arbiter.md"]

const rules: ReadonlyArray<{ readonly applies: readonly string[]; readonly test: (content: string) => boolean; readonly message: string }> = [
  {
    applies: allInstallers,
    test: (content) => /installer-lib\.mjs/u.test(content) && /\bregister\b/u.test(content) && /\bunregister\b/u.test(content),
    message: "must register and unregister the plugin through scripts/installer-lib.mjs"
  },
  {
    applies: allInstallers,
    // Config edits inside the installers cannot be tested and have deleted users' plugins before.
    test: (content) => !/JSON\.parse|delete config\.|config\.plugins?\s*=|node -e/u.test(content),
    message: "must not edit opencode config inline (JSON.parse / delete config.* / node -e); use scripts/installer-lib.mjs"
  },
  {
    applies: allInstallers,
    test: (content) => /\.opencode[/\\]plugins[/\\]open-ultracode(?![\w.-])/u.test(content) && !/plugins[/\\]open-ultracode\.ts/u.test(content),
    message: "must register the .opencode/plugins/open-ultracode directory, not a single .ts file"
  },
  {
    applies: allInstallers,
    test: (content) => /set-agent-model/u.test(content) && /get-agent-model/u.test(content),
    message: "must read and write fusion agent models through scripts/installer-lib.mjs"
  },
  {
    applies: allInstallers,
    test: (content) => /function Remove-GlobalAssets|remove_global_assets\(\)/u.test(content) && /\[switch\]\$Remove|-remove\|--remove/u.test(content),
    message: "must expose removal via -Remove (PowerShell) or -remove/--remove (sh)"
  },
  {
    applies: allInstallers,
    test: (content) => /list-models --config-dir|list-models "--config-dir"/u.test(content),
    message: "must offer the user's models via scripts/installer-lib.mjs list-models (providers first)"
  },
  {
    applies: allInstallers,
    test: (content) => /summary "?--config-dir"?/u.test(content),
    message: "must end with the installer-lib summary of what was installed (plugin entry, fusion models, assets)"
  },
  {
    applies: allInstallers,
    // Batch installs choose every fusion model without the interactive menu.
    test: (content) =>
      (/--panel-a\)/u.test(content) && /--panel-b\)/u.test(content) && /--decider\)/u.test(content) && /--non-interactive\)/u.test(content)) ||
      (/\[string\]\$PanelA/u.test(content) && /\[string\]\$PanelB/u.test(content) && /\[string\]\$Decider/u.test(content) && /\[switch\]\$NonInteractive/u.test(content)),
    message: "must accept --panel-a/--panel-b/--decider/--non-interactive (PowerShell: -PanelA/-PanelB/-Decider/-NonInteractive) for batch installs"
  },
  {
    applies: allInstallers,
    test: (content) => !/\.opencode[/\\]tools|open_ultracode_configure_fusion\.ts"? -Destination|cp [^\n]*open_ultracode_configure_fusion\.ts/u.test(content.replace(/^.*(?:rm -f|Remove-Item).*$/gmu, "")),
    message: "must not install .opencode/tools (OpenCode 2 does not load it; the plugin registers the fusion tool)"
  },
  {
    applies: shellInstallers,
    test: (content) => /^set -eu$/mu.test(content) && /^set -f$/mu.test(content),
    message: "must run with set -eu and set -f"
  },
  {
    applies: shellInstallers,
    // bash does not apply set -e inside $(...), so every substitution that can fail must propagate.
    test: (content) => !/^\s*\w+=\$\((?:choose_model|lib get-agent-model)[^\n]*\)\s*$/mu.test(content),
    message: "must propagate failures of $(choose_model ...) and $(lib ...) with '|| exit $?'"
  },
  {
    applies: shellInstallers,
    test: (content) => /model-menu\.mjs/u.test(content) && /<\/dev\/tty/u.test(content),
    message: "must run scripts/model-menu.mjs on /dev/tty so the menu works under curl | sh"
  },
  {
    applies: powershellInstallers,
    test: (content) => /function Invoke-Native/u.test(content) && /\$LASTEXITCODE -ne 0/u.test(content) && /Invoke-Native "pnpm run check"|Invoke-Native "Extracting/u.test(content),
    message: "must run native commands through Invoke-Native so non-zero exit codes stop the install"
  },
  {
    applies: powershellInstallers,
    // Silenced probes (`git ... *> $null` followed by a $LASTEXITCODE check) are allowed.
    test: (content) => !/^\s*(?:pnpm|tar|git|corepack)\s(?![^\n]*\*> \$null)/mu.test(content),
    message: "must not call pnpm, tar, git, or corepack directly; wrap them in Invoke-Native"
  },
  {
    applies: powershellInstallers,
    // Windows PowerShell 5.1 pipes scripts as ASCII and reads BOM-less files as ANSI.
    test: (content) => !/[\u0080-\u{10FFFF}]/u.test(content),
    message: "must contain only ASCII characters"
  },
  {
    applies: powershellInstallers,
    // "\n" is not a newline in PowerShell; it wrote literal backslash-n into opencode.json before.
    test: (content) => !/"[^"\n]*\\n[^"\n]*"\s*\|\s*Set-Content|-Encoding utf8/u.test(content),
    message: "must not write files with Set-Content \"...\\n...\" or -Encoding utf8 (BOM on 5.1)"
  },
  {
    applies: ["install.ps1"],
    // `irm ... | iex` runs this in the user's session, where `exit` closes their shell.
    test: (content) => !/^\s*exit\b/mu.test(content),
    message: "must throw instead of calling exit (it runs under irm | iex)"
  }
]

// Inside a double-quoted PowerShell string, "$name:" is parsed as a scope qualifier
// (like $env:PATH) and is a parse error. Only $env: is legitimate.
const psVariableScopeBugPattern = /"[^"\n]*?\$(?!env:)[A-Za-z_][A-Za-z0-9_]*:/u

export function validateInstallers(root = process.cwd()): InstallerValidationResult {
  const errors: string[] = []
  const shipped = {
    commands: listShipped(root, "commands"),
    agents: listShipped(root, "agents")
  }

  for (const relativePath of allInstallers) {
    const content = readInstaller(root, relativePath, errors)
    if (content === undefined) continue

    for (const rule of rules) {
      if (rule.applies.includes(relativePath) && !rule.test(content)) {
        errors.push(`${relativePath} ${rule.message}`)
      }
    }

    for (const [kind, names] of Object.entries(shipped)) {
      const listed = readShippedList(content, kind)
      if (listed === undefined) {
        errors.push(`${relativePath} must list the shipped ${kind} explicitly`)
      } else if (names !== undefined && listed.join(",") !== names.join(",")) {
        errors.push(`${relativePath} shipped ${kind} list is out of sync with .opencode/${kind}: expected ${names.join(", ")}`)
      }
    }
    for (const agent of fusionAgents) {
      if (!content.includes(agent)) errors.push(`${relativePath} must configure ${agent}`)
    }

    if (powershellInstallers.includes(relativePath as (typeof powershellInstallers)[number])) {
      const bug = psVariableScopeBugPattern.exec(content)
      if (bug !== null) {
        errors.push(`${relativePath} contains "$...:" inside a double-quoted string (${bug[0]}); use ${"${...}"} to delimit the variable`)
      }
      if (/\[Console\]::SetCursorPosition/u.test(content) && !/\[Console\]::BufferHeight/u.test(content)) {
        errors.push(`${relativePath} writes cursor positions without clamping to [Console]::BufferHeight`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

function listShipped(root: string, kind: string): string[] | undefined {
  const directory = join(root, ".opencode", kind)
  if (!existsSync(directory)) return undefined
  return readdirSync(directory).filter((name) => name.endsWith(".md")).sort()
}

/** Reads SHIPPED_COMMANDS="a b" (sh) or $ShippedCommands = @("a", "b") (PowerShell). */
function readShippedList(content: string, kind: string): string[] | undefined {
  const name = kind === "commands" ? "Commands" : "Agents"
  const sh = new RegExp(`^SHIPPED_${name.toUpperCase()}="([^"]*)"`, "mu").exec(content)
  if (sh?.[1] !== undefined) return sh[1].split(/\s+/u).filter(Boolean).sort()
  const ps = new RegExp(`^\\$Shipped${name} = @\\(([^)]*)\\)`, "mu").exec(content)
  if (ps?.[1] !== undefined) return [...ps[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "").sort()
  return undefined
}

function readInstaller(root: string, relativePath: string, errors: string[]): string | undefined {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) {
    errors.push(`${relativePath} is missing`)
    return undefined
  }
  return readFileSync(fullPath, "utf8")
}

if (isDirectExecution()) {
  const result = validateInstallers()
  if (result.ok) {
    console.log("OpenUltraCode installers are valid")
  } else {
    console.error(`OpenUltraCode installer validation failed:\n${result.errors.join("\n")}`)
    process.exitCode = 1
  }
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1]
  return scriptPath !== undefined && basename(scriptPath) === basename(new URL(import.meta.url).pathname)
}
