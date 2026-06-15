---
description: Run adversarial OpenUltraCode research against a plan, spec, or implementation idea.
---

Use the `open-ultracode` skill in adversarial-research mode for this request.

Workflow mode: adversarial-research

Research target:

```text
$ARGUMENTS
```

Keep the current selected model. Do not introduce a proxy, synthetic model ID, provider route, or model switch.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing research claim, plan, spec, scope, constraints, or acceptance criteria before proceeding.

Expected phases:

1. Research Question: state the claim, plan, spec, or implementation to challenge.
2. Attack The Plan: search for missing edge cases, misuse paths, unsafe defaults, and integration gaps.
3. Evidence: separate verified evidence from hypotheses and assumptions.
4. Findings: produce actionable findings with severity, confidence, affected requirement, evidence, and disposition guidance.

Research-only output must not be described as implementation completion or verification completion.
