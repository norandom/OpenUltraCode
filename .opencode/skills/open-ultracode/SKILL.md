---
name: open-ultracode
description: Use when running OpenUltraCode, ultracode-style workflows, multi-agent task decomposition, debug loops, spec-audit, adversarial research, or verification gates in opencode.
---

# OpenUltraCode

OpenUltraCode is a workflow discipline for opencode. It does not change the selected model, route traffic through a proxy, create synthetic model IDs, or bypass provider limits. Use the model already selected in opencode and make the workflow explicit.

Use this skill when the user asks for comprehensive implementation, deep debugging, adversarial research, spec-audit, incomplete-spec analysis, or verification before completion.

## Operating Rules

- Preserve the selected model. Do not ask for or assume a different model unless the user explicitly changes it.
- Keep assumptions visible. Record assumptions before acting and revise them when evidence contradicts them.
- Treat incomplete specs as research targets. Identify missing acceptance criteria, ambiguous ownership, unsafe defaults, and unverifiable claims before implementation.
- Do not claim completion without verification evidence. A passing opinion is not evidence.
- Prefer small, reviewed loops over broad unverified changes.
- If a tool or permission is denied, stop that action and report the safe next step instead of retrying around the denial.

## Workflow Phases

### Intake

Clarify the task boundary, user goal, expected output, constraints, and available verification commands. If the prompt is underspecified, ask only for information that changes the implementation or review outcome.

Capture:

- Goal and non-goals.
- Known requirements or acceptance criteria.
- Assumptions and open questions.
- Risks from missing specs, permissions, or unavailable tools.

### Planning

Decompose the work into role-sized steps. Decide whether the workflow needs build, debug, spec-audit, adversarial-research, or verify mode.

Use the simple-task shortcut for small, low-risk tasks with clear acceptance criteria. Skip explicit role dispatch, but keep proportional verification: name the assumption, make the smallest change, run the directly relevant check, and do not claim completion without evidence.

Plan with these outputs:

- Ordered phases.
- Role sequence.
- Verification evidence required before completion.
- Fallback path if subagents, tools, or high-effort controls are unavailable.

### Execution

Implement only the scoped task. Keep changes tied to the requirements and current phase. For behavior changes, prefer a RED/GREEN loop: write a failing test or validation first, implement the smallest passing change, then run the relevant checks.

### Adversarial Review

Challenge the result before accepting it. Look for missing tests, incomplete requirements, unsafe assumptions, over-broad permissions, false completion claims, security regressions, and places where the implementation exceeds the user's request.

Review findings must include:

- Finding ID.
- Severity and confidence.
- Affected requirement or assumption.
- Evidence.
- Required disposition: accept, reject, mitigate, or defer.

### Reconciliation

Resolve adversarial findings explicitly. High- or medium-severity unresolved findings block completion when review is required. Rejected findings need an evidence-based rejection reason.

### Verification

Run the checks that prove the task, not unrelated checks. Record pass, fail, blocked, skipped, and manual verification states separately. Do not claim completion when evidence is missing, skipped, or blocked.

## Role Sequence

Use roles as separate subagents when available. In single-session fallback, run the same roles sequentially in the main session and label each role's output.

1. Coordinator: owns intake, scope, phase transitions, and final status.
2. Planner: decomposes the task and identifies assumptions, risks, and verification evidence.
3. Implementer: makes the scoped change and records RED/GREEN evidence when applicable.
4. Adversary: searches for defects, missing specs, false positives, and unsafe assumptions.
5. Reconciler: accepts, fixes, rejects with rationale, or defers findings according to policy.
6. Verifier: runs fresh checks and decides whether completion is verified, partial, blocked, failed, or research-only.

## Debug Loop

Use the debug loop when implementation fails, tests fail unexpectedly, or repeated fixes do not converge.

1. Reproduce the failure with the smallest command or case.
2. Identify the failing boundary: test, code, config, permission, environment, or spec.
3. Form one root-cause hypothesis.
4. Make one targeted fix.
5. Re-run the reproducer and the relevant regression checks.
6. If the failure belongs to a missing or contradictory spec, stop and return to spec-audit.

## Spec-Audit Loop

Use spec-audit when requirements are incomplete, contradictory, or not implementation-ready.

1. Extract every explicit acceptance criterion.
2. List missing actors, inputs, outputs, error states, permissions, data boundaries, and verification methods.
3. Convert vague language into testable questions.
4. Mark assumptions as provisional until confirmed by user, code, tests, or docs.
5. Produce findings with severity, confidence, affected requirement, evidence, and proposed resolution.

## Adversarial Research Loop

Use adversarial research to challenge a proposed implementation or spec before shipping.

1. Build the strongest case that the plan is wrong or incomplete.
2. Search for missing edge cases, misuse paths, unsafe defaults, and integration gaps.
3. Separate verified findings from hypotheses.
4. Require evidence before blocking work.
5. Feed accepted findings into reconciliation and verification.

## Incomplete Spec Handling

When the spec is incomplete, do not fill gaps silently. State the assumption, explain why it matters, and choose one of these outcomes:

- Ask the user when the answer changes user-visible behavior or safety.
- Continue with a reversible assumption when the risk is low and visible.
- Block the task when implementation would encode an unsafe or unreviewable policy.
- Convert the ambiguity into a spec-audit finding when working in research mode.

## Single-Session Fallback

If subagents or multi-agent execution are unavailable, use single-session fallback. Run the coordinator, planner, implementer, adversary, reconciler, and verifier roles in order inside the current session. Keep role boundaries visible, preserve the selected model, and record degradation when the fallback changes confidence or review coverage.

## Completion Standard

Before saying a task is complete:

- Scope matches the user's request and active requirements.
- Assumptions are listed or resolved.
- Adversarial findings are reconciled.
- Verification evidence is fresh and relevant.
- Blocked, skipped, failed, and research-only states are not described as complete.

Do not claim completion when the result is only planned, partially verified, blocked by permissions, or missing evidence.
