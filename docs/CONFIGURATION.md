# OpenUltraCode Configuration

OpenUltraCode is configured through opencode's normal project files and the plugin options passed from opencode configuration.

After changing plugin files, commands, skills, agents, or opencode configuration, restart opencode. Running sessions keep the already-loaded configuration.

## Plugin

The plugin entry point lives at `.opencode/plugins/open-ultracode.ts`. It validates options, creates project-local workflow state, registers workflow tools, and observes safe hook points.

Example local plugin entry in opencode configuration:

```json
{
  "plugin": [
    ["./.opencode/plugins/open-ultracode.ts", {
      "enabled": true,
      "verificationGate": "strict",
      "adversarialReview": "required"
    }]
  ]
}
```

## Options

- `enabled`: turns OpenUltraCode plugin behavior on or off. Disabled mode returns no operational hooks.
- `verificationGate`: `strict`, `advisory`, or `disabled`.
- `adversarialReview`: `required`, `recommended`, or `disabled`.
- `highEffort.enabled`: enables best-effort request hints when compatible fields are already present.
- `highEffort.effort`: `medium`, `high`, or `xhigh`.
- `highEffort.outputTokens`: desired output-token floor for compatible request fields.
- `state.directory`: project-relative workflow state directory.
- `notices.showDegradation`: controls whether visible degradation notices are recorded when supported.

Invalid option shapes fail during plugin startup with actionable errors.

## State

Workflow state is project-local. By default, OpenUltraCode stores minimal state under `.opencode/open-ultracode/state/workflow-state.json`.

The state store rejects absolute paths, parent-directory escapes, backslash paths, and symlinked state path components. It is intended for workflow continuity, not transcripts or unrelated project data.

Sensitive or security-relevant findings should remain project-local. Do not publish, share, or externalize those findings unless the user explicitly requests it.

## Permission Behavior

OpenUltraCode respects opencode permission decisions. If a permission is denied, the plugin records a blocked workflow notice instead of retrying the denied action or working around the user's policy.

Role agents use conservative permissions:

- Review, planning, reconciliation, verification, and research agents deny edits by default.
- The implementer asks before edits and shell commands.
- The researcher asks before web fetches.

## Troubleshooting

- Commands or agents missing: restart opencode and confirm `.opencode/commands`, `.opencode/agents`, and `.opencode/skills/open-ultracode/SKILL.md` exist.
- Plugin not active: confirm the `plugin` entry points at `.opencode/plugins/open-ultracode.ts` and `enabled` is not false.
- High-effort unavailable: check workflow status for a degradation notice and continue with visible review and verification.
- Completion remains partial: record verification evidence, then run the completion report tool or `/ultracode-verify`.
- Permission blocked: adjust opencode permissions intentionally or choose a permitted path; OpenUltraCode will not retry denied operations.
