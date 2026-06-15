# OpenUltraCode

OpenUltraCode is an opencode workflow package for UltraCode-style task discipline. It keeps the model already selected in opencode, adds prompt assets, role agents, workflow commands, verification tools, and a thin plugin for state, degradation notices, and request hints.

It uses no proxy. It does not replace the selected model, create synthetic model IDs, or route provider traffic. If you change models, use opencode's normal model selection.

## Install

1. Copy this project into the repository where you want OpenUltraCode behavior.
2. Install dependencies with `npm install`.
3. Run `npm run check` to verify the package assets and TypeScript sources.
4. Add or keep the project-local opencode files under `.opencode/`.
5. Quit and restart opencode so the plugin, commands, skills, and agents are loaded.

The restart matters because opencode loads plugins, commands, skills, agents, and config at startup.

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
