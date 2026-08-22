# OpenUltraCode

OpenUltraCode adds UltraCode-style workflow discipline to opencode. It keeps the model you already selected, then adds prompt assets, role agents, slash commands, verification tools, and a small plugin for state, degradation notices, and request hints.

It uses no proxy. It does not replace the selected model, create synthetic model IDs, or route provider traffic. If you change models, use opencode's normal model selection.

## Install

1. Install the latest release with `curl -fsSL https://raw.githubusercontent.com/norandom/OpenUltraCode/main/install.sh | sh`.
2. If you already have a checkout and want the development path, run `./install-dev.sh` from the repo root.
3. The release installer pulls the latest GitHub release asset, copies the skill, slash commands, and agents into `~/.config/opencode/`, asks which fusion model IDs to set, and registers the plugin path in `~/.config/opencode/opencode.json`.
4. Quit and restart opencode so the global plugin, commands, skills, and agents are loaded.

The restart matters because opencode loads plugins, commands, skills, agents, and config at startup. If `/ultracode` does not appear, confirm you restarted opencode after running `install.sh` or `install-dev.sh`.

Release installs do not run Dagger or `pnpm run check` on the user's machine. The GitHub Actions release workflow runs build, ESLint, tests, and asset validation, then publishes `open-ultracode-release.tar.gz` as the GitHub release asset consumed by `install.sh`.

Development installs use pnpm with a 3-day release-age cooldown (`minimumReleaseAge: 4320` in `pnpm-workspace.yaml`). That keeps brand-new package releases out of the install path. `pnpm-workspace.yaml` allows the `esbuild` install script because the TypeScript test runner needs it. `install-dev.sh` also configures the repository pre-commit hook to run Dagger-backed ESLint through `pnpm run lint`.

## What you get

Slash commands are what you type in opencode:

- `/ultracode` for comprehensive build/review/verify work.
- `/ultracode-debug` for reproduce/root-cause/fix loops.
- `/ultracode-spec-audit` for incomplete or contradictory specs.
- `/ultracode-research` for adversarial research against a plan or claim.
- `/ultracode-verify` for evidence-based completion checks.
- `/ultracode-fusion` for explicit two-model fusion rounds with a selected decider.
- `/ultracode-fusion-models` to show or change the persistent panel and decider model IDs.
- `/ultrathink` for grounded, non-coding problem solving.
- `/ultrathink-fusion` for grounded, non-coding two-panel fusion problem solving.

The skill is named `open-ultracode`. It is not a slash command. The slash commands above tell opencode to use that skill, and opencode exposes skills to agents through its skill system rather than as `/open-ultracode`.

Supporting assets:

- Role agents for coordinator, planner, implementer, adversary, reconciler, verifier, and researcher workflows.
- Fusion agents for panel and arbiter roles. These are intentionally separate from the normal workflow agents.
- Plugin tools for fusion model configuration, workflow status, verification evidence, blocked checks, and completion reports.

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

Fusion workflow:

```text
/ultracode-fusion "Compare the two proposed API designs and produce one implementation recommendation."
```

Fusion with an arbiter agent:

```text
/ultracode-fusion --panel ultracode-fusion-panel-a --panel ultracode-fusion-panel-b --decider ultracode-fusion-arbiter "Review this migration plan and resolve disagreements with cited evidence."
```

Grounded problem solving without coding:

```text
/ultrathink "Decide whether we should keep the release installer shell-only or introduce a compiled helper. Use only the supplied constraints and call out unknowns."
```

Grounded fusion problem solving:

```text
/ultrathink-fusion "Evaluate the product tradeoff using grounded evidence, not loose recall."
```

`/ultrathink` and `/ultrathink-fusion` are not coding commands. They separate supplied facts, verified evidence, assumptions, hypotheses, and recommendations. If the problem depends on facts that are not supplied, they should ask for context or mark the point as unknown instead of drifting into loose recall.

## Fusion model selection

`/ultracode-fusion` is explicit opt-in fusion, not transparent routing for every prompt. A run has three model-bearing roles:

- The selected opencode model remains the coordinator. It gathers context, validates arguments, dispatches rounds, and reports the final trace.
- Exactly two panel agents produce and critique candidate answers. The configured panel pair is the default; repeated `--panel <agent-name>` flags can override it for one run.
- The configured fusion arbiter is the default decider. `--decider selected-model` or `--decider <fusion-arbiter-agent-name>` can override it for one run.

The default fusion concept is `critique-revise-vote`: each panel generates an answer from the same bounded context package, critiques the other panel's answer, revises its own answer, ranks the alternatives against the rubric, and then the decider arbitrates the final response.

The bundled defaults use exact OpenCode Zen catalog references and select each model's native maximum-reasoning variant:

- `ultracode-fusion-panel-a`: `opencode/deepseek-v4-pro#max` (DeepSeek V4 Pro at max reasoning; there is no direct model named “DeepSeek V4 Max”).
- `ultracode-fusion-panel-b`: `opencode/glm-5.2#max`.
- `ultracode-fusion-arbiter`: `opencode/kimi-k3#max`.

The OpenCode Zen defaults require that provider to be connected. The direct-provider equivalents are `deepseek/deepseek-v4-pro#max`, `zai/glm-5.2#max`, and `moonshotai/kimi-k3#max`; those require the corresponding providers to be connected in OpenCode. The dated `deepseek-v4-pro-0813` identifier is an OpenRouter snapshot, not the direct DeepSeek ID.

The release installer's terminal menu uses the up and down arrows and lets you keep these role-specific defaults, retain each role's existing value during reinstall, pick the current OpenCode model, or enter a custom model reference. Fresh non-interactive installs use the three defaults above; reinstalls preserve existing role models.

Show the effective configuration or change any subset of the roles from OpenCode:

```text
/ultracode-fusion-models
/ultracode-fusion-models --panel-a deepseek/deepseek-v4-pro#max --panel-b zai/glm-5.2#max --decider moonshotai/kimi-k3#max
```

The configuration command accepts `provider/model` or `provider/model#max`, checks the live `opencode models --verbose` catalog when shell access is available, and changes only the effective fusion agent files. Non-`max` variants are rejected so they cannot override the required effort. The tool asks for mutation permission, uses temporary files plus stale-content checks and best-effort rollback, and does not modify credentials or the selected coordinator model. Quit and restart OpenCode after changing the models so it reloads the agent metadata.

All three bundled models expose a `max` reasoning effort and every fusion agent also sets `reasoningEffort: max`. No shared `thinking` object is injected: provider-specific thinking payloads differ, and Kimi K3 does not accept the same toggle used by some other providers.

One-shot independent answers are reported as `panel-consult`, not strong fusion. Strong fusion requires the critique, revision, vote, and arbitration loop.

## Selected model preservation

OpenUltraCode inherits the active selected model from opencode. Normal bundled workflow agents do not set `model:` frontmatter, and the plugin does not install provider routes or model aliases.

Fusion agents are the deliberate exception: they use explicit `model:` frontmatter so `/ultracode-fusion` can compare two configured opencode models while the selected model remains the coordinator. This still uses opencode's native agent model selection. It is not a proxy, synthetic model ID, provider route, hidden model switch, or replacement for the selected model.

The package can add high-effort request hints only when a provider parameter already exists in the outgoing request. If the provider does not expose a compatible field, OpenUltraCode records a visible degradation notice instead of pretending the behavior is available.

## Safe troubleshooting

- If commands, agents, or skills do not appear, restart opencode.
- If high-effort behavior is unsupported, check workflow status for a degradation notice.
- If a permission is denied, OpenUltraCode records the workflow as blocked and reports the safe next step.
- If completion is partial or blocked, run `/ultracode-verify` and collect fresh evidence before claiming completion.

See `docs/CONCEPTS.md`, `docs/LIMITS.md`, and `docs/CONFIGURATION.md` for workflow details.
