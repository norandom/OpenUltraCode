# Implementation Plan

## 1. Define Fusion Command Assets

- [ ] Add an explicit fusion command asset for opencode-native multi-model fusion.
- [ ] Decide whether weaker panel consultation should be a separate command or an explicit `panel-consult` strategy.
- [ ] Ensure command prompts require bounded context packaging, strategy disclosure, two-panel selection, participant disclosure, and arbitration-mode disclosure.
- [ ] Add invocation guidance for explicit `--panel`/`--decider` selections and named presets.
- [ ] Define the opencode subagent dispatch contract used by the command, including input fields, output fields, and unavailable-subagent behavior.
- [ ] Verify normal non-fusion commands remain selected-model-first.

Done when: command assets can be inspected and validated without changing normal opencode chat behavior.

Requirements: 1, 3, 4, 5, 7

## 2. Define Fusion-Specific Agents

- [ ] Add named fusion panel subagents with explicit `model:` frontmatter for the intended alternate models.
- [ ] Add optional critic, voter, reviser, or arbiter subagents where the chosen strategy requires them.
- [ ] Support GPT-5-family, Mimo, DeepSeek, and custom model assignments through user-editable fusion agents or templates.
- [ ] Keep fusion subagent permissions narrow, preferably read-only/no-edit unless a later spec justifies broader access.
- [ ] Document every fusion agent's role, model assignment, and expected round output.
- [ ] Define the machine-checkable allowlist rule for fusion-specific agents that may use `model:` frontmatter.

Done when: alternate model usage is explicit, scoped to fusion assets, and visible to users.

Requirements: 2, 6, 8

## 3. Add Runtime Selection And Presets

- [ ] Define how users select exactly two panel agents per fusion run.
- [ ] Define how users select the decider as `selected-model` or an approved arbiter subagent.
- [ ] Add named presets such as `gpt5-pair`, `mimo-deepseek`, and `custom` as examples or templates.
- [ ] Validate invalid panel counts, unknown agents, non-fusion agents, and invalid arbiters before launching subagents.

Done when: users can choose which two models run and who decides without editing the command prompt manually.

Requirements: 3, 6, 8, 9

## 4. Implement Fusion Protocol Prompts

- [ ] Define `critique-revise-vote` as the default protocol concept: initial generation, cross-critique, revision, scoring/ranking, and arbitration.
- [ ] Define prompt templates for initial generation, cross-critique, revision, ranking/voting, and arbitration.
- [ ] Define the actor, input schema, output schema, and transition rule for every protocol round.
- [ ] Define the arbitration rubric used by selected-model and arbiter-subagent deciders.
- [ ] Ensure each round receives explicit inputs and emits structured outputs.
- [ ] Ensure subagents use supplied context only unless explicitly permitted otherwise.
- [ ] Add tests or fixtures proving one-shot panel output is labeled `panel-consult`.

Done when: strong fusion includes interaction beyond independent answers and consultation is clearly separated.

Requirements: 4, 5, 7, 9

## 5. Define Trace And Result Reporting

- [ ] Define a fusion trace shape with strategy, preset, panel agents, arbitration mode, participants, model IDs, rounds, warnings, and final decision source.
- [ ] Define the bounded context package schema, redaction fields, excluded-source reporting, and prior-round attachment model.
- [ ] Require final responses to disclose participant models and degraded states.
- [ ] Require final responses to disclose same-family model pairings and diversity caveats when applicable.
- [ ] Add tests for selected-model arbitration and arbiter-subagent arbitration trace shapes.
- [ ] Add tests for missing participants and partial failure reporting.

Done when: users can audit how the fusion result was produced.

Requirements: 3, 6, 9

## 6. Update Validation Rules

- [ ] Permit `model:` frontmatter only for approved fusion-specific agent filenames or metadata.
- [ ] Continue rejecting unexpected `model:` frontmatter in non-fusion commands and agents.
- [ ] Continue rejecting provider proxies, provider routes, model aliases, and synthetic model IDs.
- [ ] Add regression tests proving non-fusion routing remains blocked and fusion selections cannot target non-fusion agents.
- [ ] Add tests for context redaction, fusion-agent allowlist enforcement, and same-family disclosure.

Done when: validation supports explicit fusion subagents without reopening hidden routing elsewhere.

Requirements: 2, 8, 9

## 7. Document Setup And Limits

- [ ] Document that fusion uses opencode subagents with explicit alternate models.
- [ ] Document how to configure Mimo, DeepSeek, and optional arbiter model IDs.
- [ ] Document how to configure GPT-5/GPT-5-fusion-style presets when matching model access exists.
- [ ] Document how to choose two panel agents and the decider per run.
- [ ] Document that credentials belong in normal provider config or environment variables, not checked-in examples.
- [ ] Document context boundaries, cost, latency, failure states, strategy labels, and arbitration modes.
- [ ] Document per-strategy degradation rules, loop limits, and the arbitration rubric.

Done when: users can configure fusion intentionally without expecting proxy-based all-prompt fusion.

Requirements: 1, 2, 3, 6, 7, 8

## 8. Verify Boundary Invariants

- [ ] Run build, targeted tests, and asset validation.
- [ ] Review generated assets for hardcoded credentials and debug output.
- [ ] Verify fusion agent `model:` usage is explicit and limited to approved assets.
- [ ] Record verification evidence before marking implementation complete.

Done when: checks prove fusion uses opencode subagents intentionally and does not introduce hidden provider routing.

Requirements: 2, 8, 9
