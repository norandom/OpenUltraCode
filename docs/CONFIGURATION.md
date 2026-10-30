# OpenUltraCode Configuration

OpenUltraCode is configured through opencode's normal project files and the plugin options passed from opencode configuration.

After changing plugin files, commands, skills, agents, or opencode configuration, restart opencode. Running sessions keep the already-loaded configuration.

## Plugin

The plugin entry point lives at `.opencode/plugins/open-ultracode/index.ts`. OpenCode 2 loads local plugins from directories and expects a default export with an `id` and a `setup(ctx)` function. The plugin validates options, creates project-local workflow state, registers workflow tools, and observes safe hook points through the OpenCode 2 plugin context (`session`, `permission`, `tool`, and `event` domains).

Example local plugin entry in opencode configuration:

```json
{
  "plugins": [
    {
      "package": "./.opencode/plugins/open-ultracode",
      "options": {
        "enabled": true,
        "verificationGate": "strict",
        "adversarialReview": "required"
      }
    }
  ]
}
```

## Options

- `enabled`: turns OpenUltraCode plugin behavior on or off. Disabled mode returns no operational hooks.
- `verificationGate`: `strict`, `advisory`, or `disabled`.
- `adversarialReview`: `required`, `recommended`, or `disabled`.
- `highEffort.enabled`: enables best-effort request hints on the OpenCode 2 `context` hook.
- `highEffort.effort`: `medium`, `high`, or `xhigh`; mapped to the semantic `reasoningEffort` request option.
- `highEffort.outputTokens`: desired output-token budget, applied as the semantic `maxTokens` request option.
- `state.directory`: project-relative workflow state directory.
- `notices.showDegradation`: controls whether visible degradation notices are recorded when supported.

## Fusion Models

The default fusion roles are panel A `opencode/deepseek-v4-pro#max`, panel B `opencode/glm-5.2#max`, and decider `opencode/kimi-k3#max`. Each role also sets `reasoningEffort: max`. Direct-provider equivalents are `deepseek/deepseek-v4-pro#max`, `zai/glm-5.2#max`, and `moonshotai/kimi-k3#max` after those providers are connected.

Use `/ultracode-fusion-models` to display them. Change one or more roles with `--panel-a <provider/model[#max]>`, `--panel-b <provider/model[#max]>`, and `--decider <provider/model[#max]>`. The command calls the scoped `open_ultracode_configure_fusion` custom tool, which updates only known fusion agent files and configures maximum reasoning. Other variants are rejected because a later variant overlay could lower the requested effort. Quit and restart OpenCode after a change because agent metadata is loaded at startup.

The tool prefers project-local `.opencode/agents` at the worktree root, then `OPENCODE_CONFIG_DIR/agents`, `XDG_CONFIG_HOME/opencode/agents`, or `~/.config/opencode/agents`. It refuses a partial three-agent override instead of updating a lower-precedence scope that would not be fully effective. Tool invocations are permission-gated (including read-only display), and fusion subagents explicitly deny the configuration tool.

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
- Plugin not active: confirm the `plugins` array contains `{ "package": ".../.opencode/plugins/open-ultracode" }` (a directory, not a single `.ts` file) and `enabled` is not false.
- High-effort unavailable: check workflow status for a degradation notice and continue with visible review and verification.
- Completion remains partial: record verification evidence, then run the completion report tool or `/ultracode-verify`.
- Permission blocked: adjust opencode permissions intentionally or choose a permitted path; OpenUltraCode will not retry denied operations.
