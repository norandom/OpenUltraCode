---
description: Audit an incomplete or risky specification with OpenUltraCode.
---

Use the `open-ultracode` skill in spec-audit mode for this request.

Workflow mode: spec-audit

Spec or question:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

If role dispatch is unavailable, use the single-session fallback and keep the same spec-audit phases visible in order.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing spec, goal, actor, scope, constraints, or acceptance criteria before proceeding.

Expected phases:

1. Extract Criteria: list every explicit requirement, acceptance criterion, actor, input, output, and constraint.
2. Gap Analysis: identify missing behavior, ambiguous ownership, unsafe defaults, and unverifiable claims.
3. Adversarial Review: challenge assumptions, edge cases, and policy choices as if the spec will fail.
4. Findings: report severity, confidence, evidence, affected requirement, and proposed resolution.

Do not silently fill missing requirements. Ask only when an answer changes safety, user-visible behavior, or implementation ownership.
