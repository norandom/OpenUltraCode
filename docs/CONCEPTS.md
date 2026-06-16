# OpenUltraCode Concepts

OpenUltraCode is a workflow layer for opencode. It makes task phases, assumptions, adversarial review, and verification visible while preserving the model selected by the user.

The initial concept is based on [UltraCode-Shim](https://github.com/OnlyTerp/UltraCode-Shim). OpenUltraCode keeps the workflow ideas but implements them as opencode-native skills, commands, agents, and plugin hooks instead of a loopback proxy or model-routing shim.

## Workflow

The workflow is a disciplined loop:

1. Intake: identify the goal, scope, constraints, assumptions, and required evidence.
2. Planning: choose the right mode and role sequence.
3. Execution: make the scoped change or perform the scoped research.
4. Adversarial Review: challenge the plan, implementation, spec, and evidence.
5. Reconciliation: accept, fix, reject with rationale, or defer findings.
6. Verification: run fresh checks and record completion status.

Small, low-risk tasks can use the simple-task shortcut. The shortcut skips explicit role dispatch but still requires proportional verification.

## Building Blocks

- Shim: an adapter between two interfaces. UltraCode-Shim uses this pattern, but OpenUltraCode does not run a shim because it does not adapt provider traffic.
- Harness: a runner or structure that exercises a process. OpenUltraCode behaves more like a workflow harness for tasks: it gives the session phases, roles, and gates.
- Skill: reusable instructions loaded by opencode when the work matches the skill description. The OpenUltraCode skill defines the operating discipline.
- Agent: a role-specific prompt that opencode can invoke as a subagent. OpenUltraCode agents split planning, implementation, adversarial review, reconciliation, verification, and research.
- Command: a slash command that starts a workflow with a specific mode and argument shape. The bundled commands choose comprehensive, debug, spec-audit, research, or verify mode.
- Plugin: runtime glue loaded by opencode. The OpenUltraCode plugin records workflow state, exposes status and verification tools, observes blocked actions, and applies safe request hints when supported.

## Coordinator

The coordinator owns workflow mode, phase transitions, assumptions, open findings, and the completion gate. It keeps roles ordered and makes blocked or degraded states visible.

## Role Agents

- Planner: turns goals into a bounded plan and evidence checklist.
- Implementer: performs the scoped change and reports fresh validation.
- Adversary: searches for missing requirements, unsafe assumptions, and false completion claims.
- Reconciler: resolves findings and requires rationale for rejected findings.
- Verifier: checks whether evidence supports verified, partial, failed, blocked, or research-only status.
- Researcher: challenges incomplete specs, claims, and plans before implementation.

Each agent inherits the active selected model. Role files avoid `model:` frontmatter so opencode remains the source of model selection.

## Adversarial Review

Adversarial review is not general criticism. Findings must carry severity, confidence, affected requirement or assumption, evidence, and disposition. High- and medium-severity unresolved findings can block or warn depending on the configured review policy.

## Verification Gate

The verification gate compares acceptance criteria with fresh evidence. Completion is verified only when the evidence matches the claim. Missing, stale, skipped, unrelated, failed, or blocked checks do not support a completion claim.

## Single-Session Fallback

When subagents or multi-agent execution are unavailable, OpenUltraCode uses single-session fallback. The same coordinator, planner, implementer, adversary, reconciler, verifier, and researcher roles run sequentially in the current session, and the fallback is recorded as a degradation when it reduces confidence.
