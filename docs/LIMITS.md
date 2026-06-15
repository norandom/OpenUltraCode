# OpenUltraCode Limits

OpenUltraCode is not UltraCode-Shim. UltraCode-Shim is a loopback proxy and launcher that adapts Claude Code requests. OpenUltraCode is an opencode-native workflow package that keeps opencode's selected model and provider path intact.

## No Model Replacement

OpenUltraCode does not replace the selected model, install synthetic model IDs, or add provider routing. Use opencode's normal model selector when you want a different model.

## No Proxy

There is no proxy process in this package. Requests continue through opencode's configured providers.

## High-Effort Behavior

High-effort support is best effort. The plugin can adjust only supported request fields that already exist in the provider request object, such as compatible output-token or reasoning-effort fields.

If no supported field exists, the request is left unchanged and a degradation notice can be recorded in workflow state. The workflow still continues with visible discipline: assumptions, review, reconciliation, and verification.

## Hidden Reasoning

OpenUltraCode does not expose, promise, or depend on hidden reasoning. Documentation, prompts, and completion reports must use visible evidence: tests, tool results, findings, assumptions, and recorded verification.

## Provider Limits

OpenUltraCode cannot raise provider limits, change provider policies, or make unsupported controls available. If a provider ignores or lacks a high-effort control, the correct behavior is visible degradation, not a stronger claim.

## Degradation

A degradation is a user-facing notice that a requested workflow capability is unavailable or reduced. Examples include unsupported high-effort controls, unavailable multi-agent execution, corrupt local workflow state, permission denials, and failed tool phases.

Degradation is not failure by itself. It tells the user which capability changed, what confidence was affected, and what safe next action is available.
