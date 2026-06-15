---
description: Run the comprehensive OpenUltraCode workflow for the provided task.
---

Use the `open-ultracode` skill for this request.

Workflow mode: comprehensive

User task:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing user-observable goal, scope, inputs, constraints, or acceptance criteria before proceeding.

Expected phases:

1. Intake: capture goal, scope, assumptions, constraints, risks, and acceptance criteria.
2. Planning: decompose the task, decide role sequence, and name required verification evidence.
3. Execution: make only scoped changes and prefer RED/GREEN validation for behavior changes.
4. Adversarial Review: challenge implementation, tests, assumptions, and false completion claims.
5. Reconciliation: resolve findings with fixes or evidence-based rejection reasons.
6. Verification: run fresh checks and report verified, partial, blocked, failed, or research-only status.

If subagents are unavailable, use the single-session fallback and label each role's output.
