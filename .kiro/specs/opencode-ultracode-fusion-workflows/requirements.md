# Requirements Document

## Introduction

OpenUltraCode should support explicit Fusion-style workflows as separate commands that intentionally use opencode subagents backed by configured models. The selected opencode model remains the coordinator for normal chat and for launching the fusion workflow, but each fusion run must let the user choose which two panel agents run and who acts as the decider. Fusion commands may invoke named subagents with explicit `model:` frontmatter for panel, critic, reviser, voter, or arbiter roles.

The fusion behavior must be clear and auditable. It must not be a vague one-shot call to two models followed by an unstructured merge. A fusion command must define the round structure, participant roles, context package, critique/revision/voting behavior, arbitration mode, and final reporting format.

This spec covers the future implementation shape only. It does not require runtime implementation in this change.

## Boundary Context

OpenUltraCode remains an opencode workflow plugin. This spec intentionally changes the earlier selected-model-only boundary for fusion commands only:

- Normal OpenUltraCode commands continue to use the user's selected opencode model.
- Fusion commands may start opencode subagents with explicit alternate `model:` frontmatter.
- Alternate model usage must be visible in fusion-specific agent assets and documentation.
- Each fusion run may select two panel participants from configured fusion agents and may choose selected-model arbitration or a configured arbiter subagent.
- No provider proxy, synthetic model ID, hidden provider route, or transparent all-prompt interception is introduced.
- The selected model remains the workflow coordinator unless the user explicitly chooses a configured arbiter subagent.

Current opencode feasibility:

- opencode can start subagents with other models when agent files define `model:` frontmatter.
- A fusion command can instruct the selected model to invoke model-specific subagents through opencode's normal subagent mechanism.
- A decider can be the selected model or a configured arbiter subagent with its own explicit `model:` frontmatter.
- GPT-5/GPT-5-fusion-style pairings should be expressible as presets when the user has configured matching fusion agents.
- Transparent fusion for every chat prompt remains out of scope because that requires provider-level interception, a proxy, or upstream provider support.

## Requirements

### Requirement 1: Explicit Fusion Commands

**Objective:** Provide separate user-invoked fusion workflows instead of changing normal chat behavior.

**Acceptance Criteria:**

- The design defines at least one command that clearly invokes fusion behavior.
- Normal opencode prompts remain unaffected when no fusion command is used.
- Commands instruct the selected model to gather only the context needed for the fusion request.
- Commands disclose which subagents and models are intended to participate.
- Commands allow selecting two panel participants and the decider source for the run.

### Requirement 2: Intentional Model-Specific Subagents

**Objective:** Use alternate models through opencode subagents in a visible, scoped way.

**Acceptance Criteria:**

- Fusion-specific agent assets may define `model:` frontmatter for panel, critic, reviser, voter, or arbiter roles.
- Non-fusion OpenUltraCode assets must continue to avoid unexpected model routing.
- Fusion model assignments are documented and configurable by the user.
- Fusion commands can reference configured agents by stable IDs rather than hardcoding one pair of models.
- The design does not add provider proxies, synthetic model IDs, or hidden provider routes.

### Requirement 3: Runtime Panel And Decider Selection

**Objective:** Let users decide which two models run and who makes the final decision.

**Acceptance Criteria:**

- The command supports selecting exactly two panel agents for the primary fusion run.
- The command supports selecting the decider as either `selected-model` or a configured arbiter subagent.
- The design supports named presets such as `gpt5-pair`, `mimo-deepseek`, or `custom` without requiring those exact presets.
- Invalid panel or decider selections produce a clear setup error before any fusion round starts.

### Requirement 4: Clear Fusion Protocol

**Objective:** Define fusion as a structured multi-agent protocol, not a naive merge.

**Acceptance Criteria:**

- The planned default fusion concept is `critique-revise-vote`: independent generation, cross-critique, revised answers, scored vote/ranking, and final arbitration.
- Every round has explicit inputs, outputs, and participant roles.
- The same bounded context package is supplied to each participant unless a round explicitly receives prior-round outputs.
- The final answer includes a trace summary identifying which roles contributed and how the decision was made.
- The protocol defines the actor, input schema, output schema, and transition rule for each round.
- The protocol defines a scoring rubric for final arbitration.

### Requirement 5: Consultation Versus Fusion Semantics

**Objective:** Avoid presenting one-shot panel consultation as strong fusion.

**Acceptance Criteria:**

- The design distinguishes `panel-consult` from `fusion`.
- `panel-consult` means independent model answers with no interaction loop.
- Strong fusion strategy names are explicit, for example `debate-rank`, `critique-revise`, or `vote-decide`.
- If only one-shot panel output is available, the result is labeled as consultation, not fusion.

### Requirement 6: Decider And Arbitration Modes

**Objective:** Support decider behavior using opencode-native mechanisms.

**Acceptance Criteria:**

- The default decider is the selected opencode model acting as coordinator after receiving subagent outputs and trace data.
- An optional arbiter subagent may act as decider when explicitly configured with visible `model:` frontmatter.
- The design documents that the arbiter subagent is an opencode subagent, not a hidden model switch.
- The final response discloses whether the selected model or arbiter subagent made the arbitration decision.

### Requirement 7: Context And Data Boundaries

**Objective:** Fusion must make context transfer explicit because subagents only see the prompts and context provided to them.

**Acceptance Criteria:**

- Commands tell the selected model to construct a bounded context package before launching fusion subagents.
- The protocol separates user task, constraints, context, strategy, selected panel agents, and arbitration mode.
- The design warns that secrets and unrelated files must not be included in the context package.
- Subagents do not independently expand repository context unless their role and permissions explicitly allow it.
- The context package defines size limits, citations, excluded paths, redaction requirements, and how prior-round outputs are attached.

### Requirement 8: Configuration And Secrets

**Objective:** Configure fusion subagents without hardcoding credentials or adding hidden provider behavior.

**Acceptance Criteria:**

- Fusion subagent model IDs are explicit in fusion agent assets or user configuration.
- Fusion presets map names to panel agent pairs and optional arbiter agents.
- Provider credentials remain in normal opencode/provider configuration or environment variables, not checked-in examples.
- Missing configured models or unavailable subagents produce a clear degradation notice.
- The spec keeps proxy-based provider interception out of scope.
- Fusion-specific agent eligibility is enforced by an explicit allowlist rule, not by ad hoc prompt wording.

### Requirement 9: Verification And Auditability

**Objective:** Fusion results must be reviewable and testable.

**Acceptance Criteria:**

- Fusion outputs include strategy, subagent roles, model identifiers, round summaries, warnings, and final decision source.
- The implementation plan includes validation that `model:` frontmatter is allowed only for approved fusion-specific agent assets.
- The implementation plan includes tests for runtime panel/decider selection and invalid selections.
- The implementation plan includes tests for protocol trace generation and consultation labeling.
- Failure states are visible to the selected model and final response.
- The implementation plan includes tests for round ownership, arbitration rubric reporting, context redaction, and partial-failure labeling.
