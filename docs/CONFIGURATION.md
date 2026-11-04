# OpenUltraCode Configuration

OpenUltraCode is configured through opencode's normal project files and the plugin options passed from opencode configuration.

After changing plugin files, commands, skills, agents, or opencode configuration, restart opencode. Running sessions keep the already-loaded configuration.

## Plugin

The plugin entry point lives at `.opencode/plugins/open-ultracode/index.ts`. OpenCode 2 loads local plugins from directories and expects a default export with an `id` and a `setup(ctx)` function. The plugin validates options, registers workflow tools, and observes safe hook points through the OpenCode 2 plugin context (`session`, `permission`, `tool`, and `event` domains). `tests/plugin-contract.test.ts` type-checks this against the real `@opencode/plugin` API.

Running an OpenUltraCode command (for example `/ultracode`) starts a project-local workflow record in the project root, even when opencode runs in a subdirectory. The model keeps it current with `open_ultracode_record_intake` (goal, criteria, phase), `open_ultracode_record_verification`, `open_ultracode_record_blocked_check`, `open_ultracode_status`, and `open_ultracode_completion_report`. Hook failures inside the plugin are logged and never fail your prompt, tool call, permission check, or compaction. If the plugin is registered twice (for example globally and in the project), the second instance stays inactive.

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
- `highEffort.effort`: `medium`, `high`, or `xhigh`; mapped to the semantic `reasoningEffort` request option. The plugin reads the selected model's variants from opencode's model list (`ctx.model.list()`) and sends the strongest declared variant effort that does not exceed this level, for example `high` for a model declaring `low`, `high`, `max` when `xhigh` is configured. Models that declare no variants, and models opencode does not list, get no reasoning effort: providers reject undeclared values (Mistral answers `400 Bad Request`). A stronger effort that opencode already set, for example through a selected variant, is kept.
- `highEffort.outputTokens`: desired output-token budget, applied as the semantic `maxTokens` request option and capped at the selected model's output limit (`limit.output` from opencode's model list). When opencode does not know the model, the configured value is used.
- `state.directory`: project-relative workflow state directory.
- `notices.showDegradation`: controls whether visible degradation notices are recorded when supported.

## Fusion Models

The default fusion roles are panel A `opencode/deepseek-v4-pro#max`, panel B `opencode/glm-5.2#max`, and decider `opencode/kimi-k3#max`. Each role also sets `reasoningEffort: max`. Direct-provider equivalents are `deepseek/deepseek-v4-pro#max`, `zai/glm-5.2#max`, and `moonshotai/kimi-k3#max` after those providers are connected.

Use `/ultracode-fusion-models` to display them. Change one or more roles with `--panel-a <provider/model[#max]>`, `--panel-b <provider/model[#max]>`, and `--decider <provider/model[#max]>`. The command calls the scoped `open_ultracode_configure_fusion` custom tool, which updates only known fusion agent files. `#max` writes `variant: max` and `reasoningEffort: max`; a base `provider/model` writes neither. The tool refuses `#max` for a model whose opencode variants do not include `max` (opencode would refuse to start such an agent with "Variant unavailable") and names the declared variants. Other variants are rejected because a later variant overlay could lower the requested effort. Before a fusion workflow dispatches its panels, the plugin checks every fusion agent against opencode's live model list: an unavailable provider (for example a plugin provider that needs an opencode restart), a model opencode does not list, or a variant the model does not declare. For each problem it computes a valid fallback from the same provider (the same model without the variant, or the most similar model that declares it) and adds the problem, the fallback, and further valid choices to the prompt, together with an instruction for the coordinator: explain the problem, propose the fallback or another model from `open_ultracode_list_models`, ask the user to confirm or correct it, and only then call `open_ultracode_configure_fusion`. Nothing changes without the user's answer and the tool's permission prompt. Each problem is also recorded as a degradation notice. opencode 2.2.5 applies an edited fusion agent to its next dispatch, so a fusion run can continue after a fix; restart opencode if a running session still uses the previous model.

The tool prefers project-local `.opencode/agents` at the worktree root, then `OPENCODE_CONFIG_DIR/agents`, `XDG_CONFIG_HOME/opencode/agents`, or `~/.config/opencode/agents`. It refuses a partial three-agent override instead of updating a lower-precedence scope that would not be fully effective. Tool invocations are permission-gated (including read-only display), and fusion subagents explicitly deny the configuration tool.

Invalid option shapes fail during plugin startup with actionable errors.

## State

Workflow state is project-local. By default, OpenUltraCode stores minimal state under `.opencode/open-ultracode/state/workflow-state.json`.

The state store rejects absolute paths, parent-directory escapes, backslash paths, and symlinked state path components. It is intended for workflow continuity, not transcripts or unrelated project data.

Sensitive or security-relevant findings should remain project-local. Do not publish, share, or externalize those findings unless the user explicitly requests it.

## Permission Behavior

OpenUltraCode respects opencode permission decisions. If a tool call is denied or the user rejects a permission request, the plugin records a blocked workflow notice instead of retrying the denied action or working around the user's policy. A failure of one of OpenUltraCode's own tools also blocks the workflow. Ordinary tool errors (a failed search, a missing file, an MCP error) are recorded as warnings and do not block. Resume a blocked workflow with `open_ultracode_record_intake` once the blocker is resolved.

Role agents use conservative permissions:

- Review, planning, reconciliation, verification, and research agents deny edits by default.
- The implementer asks before edits and shell commands.
- The researcher asks before web fetches.

## Uninstall

Run the matching installer with its removal flag to undo an install:

- sh release: `./install.sh -remove` (or `--remove`, `-r`); piped form: `curl -fsSL https://raw.githubusercontent.com/norandom/OpenUltraCode/main/install.sh | sh -s -- --remove`
- sh dev: `./install-dev.sh -remove`
- PowerShell release: `.\install.ps1 -Remove`
- PowerShell dev: `.\install-dev.ps1 -Remove`

Removal deletes the copied skill and exactly the commands and agents OpenUltraCode ships (plus `tools/` and `lib/` files left by releases before OpenCode 2) from the opencode config directory, removes OpenUltraCode's plugin entries and the `open_ultracode_configure_fusion` permission rule from `opencode.json` and `opencode.jsonc` without touching other plugins, permissions, or settings, and (for release installs) deletes the downloaded release directory. A `.backup-openultracode-*` copy is written before a config file changes. Dev checkouts are left in place. Restart opencode after removal.

## Troubleshooting

- Commands or agents missing: restart opencode and confirm `.opencode/commands`, `.opencode/agents`, and `.opencode/skills/open-ultracode/SKILL.md` exist.
- Plugin not active: confirm the `plugins` array contains `{ "package": ".../.opencode/plugins/open-ultracode" }` (a directory, not a single `.ts` file) and `enabled` is not false.
- `Plugin failed to load` with a path to a missing `open-ultracode.ts` or an old version directory: an older release left an entry in `opencode.json` or `opencode.jsonc`. Re-run the installer; it replaces stale OpenUltraCode entries in both files with one current entry.
- High-effort unavailable: check workflow status for a degradation notice and continue with visible review and verification.
- Completion remains partial: record verification evidence, then run the completion report tool or `/ultracode-verify`.
- Permission blocked: adjust opencode permissions intentionally or choose a permitted path; OpenUltraCode will not retry denied operations.
