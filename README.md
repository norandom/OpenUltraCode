# OpenUltraCode

OpenUltraCode is an opencode workflow package for UltraCode-style task discipline. It keeps the model already selected in opencode, adds prompt assets, role agents, workflow commands, verification tools, and a thin plugin for state, degradation notices, and request hints.

It uses no proxy. It does not replace the selected model, create synthetic model IDs, or route provider traffic. If you change models, use opencode's normal model selection.

## Install

1. Install the latest release with `curl -fsSL https://raw.githubusercontent.com/norandom/OpenUltraCode/main/install.sh | sh`, or run `./install.sh` from a checkout to install and verify locally.
2. For local development, run `pnpm install` and `pnpm run check`.
3. Add or keep the project-local opencode files under `.opencode/`.
4. Quit and restart opencode so the plugin, commands, skills, and agents are loaded.

The restart matters because opencode loads plugins, commands, skills, agents, and config at startup.

Dependency installs use pnpm with a 3-day release-age cooldown (`minimumReleaseAge: 4320` in `pnpm-workspace.yaml`) so brand-new package releases are not selected immediately. `pnpm-workspace.yaml` explicitly allows the `esbuild` install script required by the TypeScript test runner.

The installer also configures the repository pre-commit hook to run Dagger-backed ESLint through `pnpm run lint`.

## What You Get

- `/ultracode` for comprehensive build/review/verify work.
- `/ultracode-debug` for reproduce/root-cause/fix loops.
- `/ultracode-spec-audit` for incomplete or contradictory specs.
- `/ultracode-research` for adversarial research against a plan or claim.
- `/ultracode-verify` for evidence-based completion checks.
- Role agents for coordinator, planner, implementer, adversary, reconciler, verifier, and researcher workflows.
- Plugin tools for workflow status, verification evidence, blocked checks, and completion reports.

## Examples

Comprehensive task execution:

```text
/ultracode "Implement the approved registration-flow task, run the relevant tests, reconcile adversarial findings, and report completion evidence."
```

Debugging:

```text
/ultracode-debug "The docs asset test fails after adding a new command. Reproduce the failure, find the root cause, fix the smallest boundary, and verify the regression."
```

Spec audit:

```text
/ultracode-spec-audit "Review this checkout spec for missing actors, permissions, error states, and verification criteria before implementation."
```

Adversarial research:

```text
/ultracode-research "Attack this implementation plan and identify assumptions, edge cases, unsafe defaults, and evidence gaps before we build it."
```

## Selected Model Preservation

OpenUltraCode inherits the active selected model from opencode. The bundled agents do not set `model:` frontmatter, and the plugin does not install provider routes or model aliases.

The package can add high-effort request hints only when a provider parameter already exists in the outgoing request. If the provider does not expose a compatible field, OpenUltraCode records a visible degradation notice instead of pretending the behavior is available.

## Safe Troubleshooting

- If commands, agents, or skills do not appear, restart opencode.
- If high-effort behavior is unsupported, check workflow status for a degradation notice.
- If a permission is denied, OpenUltraCode records the workflow as blocked and reports the safe next step.
- If completion is partial or blocked, run `/ultracode-verify` and collect fresh evidence before claiming completion.

See `docs/CONCEPTS.md`, `docs/LIMITS.md`, and `docs/CONFIGURATION.md` for workflow details.
