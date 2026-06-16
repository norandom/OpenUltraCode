# Research Log

## Summary

OpenUltraCode is a greenfield opencode-native workflow package. The design should not reproduce UltraCode-Shim's proxy, model aliasing, or API translation. It should adapt the useful workflow mechanics: layered instructions, phase discipline, role-specialized subagents, adversarial critique, reconciliation, verification gates, and explicit degradation when a hook or provider capability is unavailable.

The implementation surface is opencode configuration, project-local skills, project-local command markdown files, project-local agent markdown files, and a TypeScript plugin. The selected opencode model remains authoritative. OpenUltraCode must avoid agent-level model overrides by default so role agents inherit the current model from the invoking primary agent.

## Discovery Scope

- Read the generated requirements in `.kiro/specs/opencode-ultracode-workflow-plugin/requirements.md`.
- Used fallback Kiro design templates and design rules from `/home/mc/Source/UltraCode-Shim` because `/home/mc/Source/OpenUltraCode` has no `.kiro/settings/templates` or `.kiro/steering` yet.
- Verified current opencode schema from `https://opencode.ai/config.json`.
- Verified opencode plugin, agent, and command behavior from official docs at `https://opencode.ai/docs/plugins/`, `https://opencode.ai/docs/agents/`, and `https://opencode.ai/docs/commands/`.
- Reused UltraCode-Shim workflow concepts from prior repository inspection: `docs/DIRECTIVES.md`, `examples/role_pipeline_workflow.js`, and `examples/demo/PROMPT.md`.

## Research Log

### Opencode Plugin Surface

**Sources:** `https://opencode.ai/docs/plugins/`, `https://opencode.ai/config.json`

**Findings:**
- Project plugins live in `.opencode/plugins/` and are loaded at startup.
- A plugin is a JavaScript or TypeScript module exporting one or more plugin functions.
- Local plugins can import types from `@opencode-ai/plugin` and may use dependencies from `.opencode/package.json`; opencode installs them with Bun at startup.
- Hooks can observe all events through `event`, alter shell environment through `shell.env`, intercept tool execution through `tool.execute.before` and `tool.execute.after`, inject compaction context through `experimental.session.compacting`, expose custom tools through `tool`, and observe command/session/todo events.
- The schema accepts `plugin` as an array of strings or `[name, options]` tuples, but project-local files in `.opencode/plugins/` are auto-loaded without config entries.

**Implications:**
- The plugin owns runtime guardrails and low-level integrations: status markers, degradation notices, verification-state tracking, compaction persistence, custom status/verification tools, and optional provider option injection where opencode exposes a safe hook.
- The plugin should not own the full workflow prompt. Long-form workflow instructions belong in the skill and command templates, which are visible and easier to audit.
- Plugin options need a strongly typed local configuration module rather than relying on arbitrary config keys, because opencode strictly validates config and rejects unknown top-level fields.

### Opencode Agents

**Sources:** `https://opencode.ai/docs/agents/`, `https://opencode.ai/config.json`

**Findings:**
- Project agents can be defined as markdown files in `.opencode/agents/`.
- Agents support `mode: primary`, `mode: subagent`, or `mode: all`.
- Subagents can be invoked manually with `@agent` or automatically by primary agents when task permissions permit.
- If a subagent does not set `model`, it uses the model of the primary agent that invoked it.
- Agent `permission` overrides are the correct way to restrict edit, bash, web, and task access.
- `permission.task` can restrict which subagents a primary agent can invoke.
- Additional agent options pass through to the provider, but they are model/provider-specific.

**Implications:**
- OpenUltraCode role agents should omit `model` by default to preserve selected-model operation.
- The package should provide a primary orchestrator agent and specialized subagents for planner, implementer, adversary, verifier, reconciler, and researcher.
- Read-only roles such as adversary, verifier, and spec researcher should deny edits by default and use constrained bash/web permissions.
- Provider-specific high-effort controls should be optional configuration examples, not a hard dependency in role agents.

### Opencode Commands

**Sources:** `https://opencode.ai/docs/commands/`, `https://opencode.ai/config.json`

**Findings:**
- Project commands can be defined as markdown files in `.opencode/commands/`.
- The file name becomes the slash command name.
- Command frontmatter supports `description`, `agent`, `model`, and `subtask`.
- Command bodies become templates and support `$ARGUMENTS`, positional arguments, file references with `@file`, and shell-output interpolation.
- Commands can also be defined inline in `opencode.json` under `command`, but markdown files are better for long prompts.

**Implications:**
- OpenUltraCode should ship command markdown files for `/ultracode`, `/ultracode-debug`, `/ultracode-spec-audit`, `/ultracode-research`, and `/ultracode-verify`.
- Commands should not set `model` by default because that would override the user's selected model.
- Command templates should name the selected workflow mode, expected phases, and missing-context behavior.

### Skills And Layered Workflow Guidance

**Sources:** customize-opencode skill reference; opencode skill paths and frontmatter rules from prior context.

**Findings:**
- Skills live in `.opencode/skills/<name>/SKILL.md`.
- Skills require `name` and a useful `description` to be surfaced.
- Skill content is the best place for long-lived workflow instructions because it is visible, auditable, and selected by the model when applicable.

**Implications:**
- The core workflow brain should be `.opencode/skills/open-ultracode/SKILL.md`.
- The skill should be layered: routing layer, phase layer, role layer, adversarial layer, verification layer, and degradation layer.
- The plugin should reinforce but not hide the skill's instructions.

### UltraCode-Shim Workflow Concepts To Adapt

**Sources:** prior inspection of UltraCode-Shim `docs/DIRECTIVES.md`, `examples/role_pipeline_workflow.js`, and `examples/demo/PROMPT.md`.

**Findings:**
- UltraCode-Shim demonstrates explicit phase pipelines: plan, code, review, fix.
- It uses role-specific prompts for planner, implementer, adversarial reviewer, and fixer.
- Its review output is structured around verdicts such as `ship`, `fix`, and `reject`, severity, evidence, and fix instructions.
- It includes route/directive ideas, but those are proxy/model-routing concerns and are out of scope.

**Implications:**
- OpenUltraCode should adapt the role pipeline and structured review schema.
- OpenUltraCode should not adapt `[[route:...]]`, synthetic worker models, or provider routing.
- The reconciler role should be explicit because a comprehensive workflow needs to decide whether adversarial findings are true positives, false positives, clarifications, or accepted fixes.

## Architecture Pattern Evaluation

### Option A: Plugin-Centric Workflow Engine

The plugin could attempt to run the entire workflow by intercepting messages and orchestrating agent calls.

**Rejected.** This would hide important prompts from users, couple the package to unstable hook details, and risk fighting opencode's own agent loop. It also makes incomplete-spec judgment harder to audit.

### Option B: Skill-Only Workflow Pack

The package could provide only skills, commands, and agents without a plugin.

**Rejected.** This is transparent but cannot reliably persist phase state through compaction, surface runtime degradation, or provide explicit workflow status and verification tools.

### Option C: Layered Skill With Thin Enforcement Plugin

The skill and commands own workflow intelligence. Agents own role-specific prompts and permissions. The plugin owns runtime guardrails, state persistence, degradation reporting, optional high-effort request mutation, and small custom tools.

**Selected.** This matches opencode's extension model, keeps prompts auditable, avoids replacing selected model behavior, and gives the plugin a narrow public surface with a thicker internal implementation.

## Design Decisions

1. Preserve selected model by default. Commands and role agents will omit `model` unless the user explicitly configures an override outside the default package.
2. Use project-local markdown files for commands and agents. This keeps prompts inspectable and avoids large inline JSON configuration.
3. Use a TypeScript plugin with explicit internal types and no `any`. Type boundaries will define workflow modes, phases, severity, verdicts, config, state snapshots, and degradation notices.
4. Store workflow state inside `.opencode/open-ultracode/state/` by default. This is project-local and user-visible, satisfying the requirement not to store task content outside the project without consent.
5. Keep workflow state lightweight. Store phase, mode, timestamps, findings summaries, verification evidence references, and degradation notices; do not persist full private task content unless the user explicitly enables transcripts.
6. Treat high-effort controls as best-effort. The plugin can inject supported provider options through available hooks where known, but the workflow must continue and report degradation if unsupported.
7. Make adversarial review required by workflow policy, not hidden magic. Strict, advisory, and disabled modes will be represented in config and surfaced in command output.
8. Use a single-session fallback. If task/subagent execution is unavailable, the command template and skill instruct the current agent to execute the same phase sequence in one session.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Opencode hook names or payloads change | Plugin behavior may degrade | Keep plugin narrow, guard every optional hook, provide visible degradation notices, and pin docs/tests to observed hook contracts |
| Provider rejects high-effort options | User may think deeper effort was applied when it was not | Report unavailable high-effort controls through status and final summaries |
| Role agents accidentally override selected model | Violates core requirement | Omit `model` in default agent and command frontmatter; test generated files for absent model overrides |
| Adversarial findings become noisy | Workflow slows or fixes false positives | Require reconciler evidence and classify findings as accepted, rejected, clarification-needed, or deferred |
| Plugin persists sensitive content | Privacy and scope violation | Store only minimal state by default and document transcript opt-in separately |
| Commands lack enough context | Workflow may invent task goals | Command templates must ask focused questions when required context is missing |

## Synthesis Outcomes

- The main generalization is a phase state machine shared across build, debug, spec-audit, adversarial-research, and verify workflows. The same state model covers planning, execution/research, adversarial review, reconciliation, verification, and completion.
- The build-vs-adopt decision is to adopt opencode's native command, agent, skill, permission, and plugin mechanisms instead of building a custom runner.
- The simplification is to avoid a separate orchestrator process. The opencode primary agent remains the orchestrator; OpenUltraCode provides prompts, role agents, and plugin guardrails.
- The design boundary is clear: OpenUltraCode can influence prompts, agent roles, permissions, state, and request options; it cannot guarantee provider reasoning behavior, hidden chain-of-thought, model routing, or private Claude Code dynamic workflow features.

## Revalidation Triggers

- Opencode changes plugin hook names, command frontmatter, agent inheritance behavior, or permission semantics.
- The package adds a non-default model override or provider-specific high-effort mapping.
- State persistence moves outside the project directory.
- A new workflow mode is added beyond build, debug, spec-audit, adversarial-research, or verify.
- The implementation starts invoking external network services beyond normal opencode model/provider use.
