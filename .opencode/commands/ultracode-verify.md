---
description: Verify OpenUltraCode workflow evidence before reporting completion.
---

Use the `open-ultracode` skill in verify mode for this request.

Workflow mode: verify

Verification target:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

If role dispatch is unavailable, use the single-session fallback and keep the same verification phases visible in order.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing completion claim, acceptance criteria, evidence, constraints, or verification target before proceeding.

Expected phases:

1. Evidence Inventory: list acceptance criteria, required checks, collected evidence, skipped checks, blocked checks, and assumptions.
2. Run Checks: execute fresh relevant commands or identify manual verification that cannot be automated.
3. Completion Report: classify the result as verified, partial, blocked, failed, or research-only.

Do not claim completion when evidence is stale, missing, skipped, blocked, or unrelated to the requested task.
