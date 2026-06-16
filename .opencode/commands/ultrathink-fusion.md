---
description: Run grounded non-coding problem solving through an explicit two-panel fusion loop.
---

Use the `open-ultracode` skill for this request.

Workflow mode: ultrathink-fusion

Problem and fusion options:

```text
$ARGUMENTS
```

Keep the current selected model as the coordinator. Do not introduce a proxy, synthetic model ID, provider route, hidden model switch, or transparent all-prompt fusion.

This is not a coding command. Do not edit files, write implementation code, run broad build steps, or change project state unless the user explicitly asks to convert the final recommendation into implementation work.

If `$ARGUMENTS` does not provide enough task context, ask focused questions for the missing problem, known facts, panel selection, decider, grounding evidence, scope, constraints, or output format before proceeding.

Default strategy: `grounded-critique-revise-vote`.

Selection requirements:

- Require exactly two `--panel <fusion-agent-id>` selections, or a preset that expands to exactly two fusion panel agents.
- Support `--decider selected-model` or `--decider <fusion-arbiter-agent-id>`.
- Reject unknown agents, non-fusion agents, invalid panel counts, or invalid deciders before launching subagents.
- Treat `selected-model` as the current selected opencode model acting as coordinator and final arbiter.

Grounding rules:

- Build a bounded context package before dispatching any subagent.
- Separate supplied facts, verified evidence, assumptions, hypotheses, and recommendations in every round.
- Do not let panels answer from loose recall when the problem depends on project, user, or external facts that are not supplied.
- Require citations to supplied context for factual claims; otherwise mark the claim as an assumption or hypothesis.
- Do not silently substitute another model or agent if dispatch fails.

Fusion protocol:

1. Intake: capture problem, selected panels, decider, strategy, facts, constraints, risks, and desired output.
2. Grounding: define the bounded context package, evidence labels, forbidden recall-only claims, and unknowns.
3. Divergent Reasoning: each panel independently proposes options from the same grounded package.
4. Cross-Critique: each panel challenges the other panel's claims, assumptions, and missing evidence.
5. Revision And Vote: panels revise recommendations, rank options, and disclose uncertainty.
6. Arbitration: the decider synthesizes one grounded recommendation or states that evidence is insufficient.
7. Verification: report confidence, unresolved assumptions, degraded states, and the smallest next evidence needed.

Arbitration rubric:

- correctness against supplied context;
- evidence support and citation quality;
- adherence to user constraints and non-coding boundary;
- clarity of assumptions and unknowns;
- robustness under critique;
- uncertainty and unresolved disagreements;
- simplicity and actionability.

Final response requirements:

- Disclose strategy, selected panel agents, decider source, visible model identifiers, round summaries, degraded states, warnings, and final decision source.
- Label independent one-shot panel output as `panel-consult`, not strong fusion.
- Disclose same-family model pairings and any diversity caveat.
- Do not present unsupported recall as grounded evidence.

If subagents are unavailable, use the single-session fallback for coordination only and report that real fusion subagent dispatch was blocked.
