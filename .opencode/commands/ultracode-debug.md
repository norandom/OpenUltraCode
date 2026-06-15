---
description: Run the OpenUltraCode debug loop for a failing task, test, or workflow.
---

Use the `open-ultracode` skill in debug mode for this request.

Workflow mode: debug

Debug target:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing failure symptom, repro command, expected behavior, constraints, or acceptance criteria before proceeding.

Expected phases:

1. Intake: identify the failure, scope, recent changes, assumptions, and available repro command.
2. Reproduce: run or describe the smallest failing case before changing code.
3. Root Cause: isolate whether the fault is test, code, config, permission, environment, or spec.
4. Fix: make one targeted change tied to the root cause.
5. Verification: re-run the reproducer and relevant regression checks before claiming resolution.

If the root cause is an incomplete or contradictory spec, stop the fix loop and route to spec-audit.
