---
description: Run grounded OpenUltraCode problem solving without coding or implementation changes.
---

Use the `open-ultracode` skill for this request.

Workflow mode: ultrathink

Problem to solve:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

This is not a coding command. Do not edit files, write implementation code, run broad build steps, or change project state unless the user explicitly asks to turn the result into implementation work.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing goal, decision to make, known facts, constraints, stakeholders, accepted evidence, or output format before proceeding.

Grounding rules:

- Separate supplied facts, verified evidence, assumptions, hypotheses, and recommendations.
- Do not answer from loose recall when the problem depends on project, user, or external facts that are not supplied.
- Use available context and cited excerpts when available; otherwise state what is unknown and what evidence would change the answer.
- Prefer a compact decision frame over a long essay: problem, constraints, options, tradeoffs, recommendation, confidence, and next evidence.

Expected phases:

1. Intake: capture the problem, decision boundary, supplied facts, constraints, and desired output.
2. Grounding: identify what is evidenced, what is assumed, and what is unknown.
3. Option Generation: produce plausible answers or strategies without coding.
4. Critique: test each option against constraints, failure modes, and missing evidence.
5. Synthesis: recommend one path or explain why the decision remains underdetermined.
6. Verification: report confidence, unresolved assumptions, and the smallest next evidence needed.

If subagents are unavailable, use the single-session fallback and label each phase's output.
