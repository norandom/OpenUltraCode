---
description: Run an explicit OpenUltraCode fusion workflow with two selected panel subagents and a decider.
---

Use the `open-ultracode` skill for this request.

Workflow mode: comprehensive

Fusion task and options:

```text
$ARGUMENTS
```

Keep the current selected model as the coordinator. Do not introduce a proxy, synthetic model ID, provider route, hidden model switch, or transparent all-prompt fusion.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing goal, panel selection, decider, strategy, scope, constraints, or acceptance criteria before proceeding.

Default strategy: `critique-revise-vote`.

Selection requirements:

- Require exactly two `--panel <fusion-agent-id>` selections, or a preset that expands to exactly two fusion panel agents.
- Support `--decider selected-model` or `--decider <fusion-arbiter-agent-id>`.
- Reject unknown agents, non-fusion agents, invalid panel counts, or invalid deciders before launching subagents.
- Treat `selected-model` as the current selected opencode model acting as coordinator and final arbiter.

Subagent dispatch contract:

- Build a bounded context package before dispatching any subagent.
- Send each fusion subagent the selected strategy, current round, role, bounded context package, required prior-round outputs, and expected structured output.
- Do not let subagents independently expand context unless the role and permissions explicitly allow it.
- Do not silently substitute another model or agent if dispatch fails.

Fusion protocol:

1. Intake: capture task, selected panels, decider, strategy, constraints, risks, and acceptance criteria.
2. Planning: define the bounded context package, round sequence, subagent dispatches, arbitration rubric, degradation policy, and required verification evidence.
3. Execution: run `critique-revise-vote` unless another explicit strategy is requested: generation, cross-critique, revision, vote/rank, and arbitration.
4. Adversarial Review: challenge model outputs, missing evidence, context leakage, routing boundaries, and false fusion claims.
5. Reconciliation: resolve conflicts, degraded states, and findings with fixes or evidence-based rejection reasons.
6. Verification: report verified, partial, blocked, failed, or research-only status with a trace summary.

Arbitration rubric:

- correctness against supplied context;
- evidence support and citation quality;
- adherence to user constraints and boundary commitments;
- implementation feasibility;
- risk of hidden routing, proxy behavior, or unsafe permissions;
- uncertainty and unresolved disagreements;
- simplicity and maintainability.

Final response requirements:

- Disclose strategy, selected panel agents, decider source, visible model identifiers, round summaries, degraded states, warnings, and final decision source.
- Label independent one-shot panel output as `panel-consult`, not strong fusion.
- Disclose same-family model pairings and any diversity caveat.

If subagents are unavailable, use the single-session fallback for coordination only and report that real fusion subagent dispatch was blocked.
