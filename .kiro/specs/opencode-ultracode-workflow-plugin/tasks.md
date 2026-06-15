# Implementation Plan

## 1. Establish The Project Foundation

- [x] 1.1 Create the package, runtime, and test scaffolding
  _Boundary: Project Scaffolding_
  _Requirements: 1.2, 9.6, 12.3_
  - Set up the package manifest, TypeScript compiler configuration, test runner configuration, source tree, opencode asset directories, and validation script entry point described in the design.
  - Done when the repository has a runnable build command, a runnable test command, and empty but correctly located source, plugin, skill, agent, command, docs, and test directories.

- [ ] 1.2 Define the shared workflow contracts
  _Boundary: Shared Contracts_
  _Depends: 1.1_
  _Requirements: 2.3, 4.6, 5.4, 5.5, 8.4, 8.5, 9.2, 9.3, 9.4_
  - Add strongly typed contracts for workflow modes, phases, gate policies, adversarial policies, findings, finding dispositions, acceptance criteria, verification evidence, degradation notices, completion reports, and persisted workflow state.
  - Done when all runtime modules and tests can import the same contracts without duplicate type definitions or unsafe untyped values.

- [ ] 1.3 Implement typed configuration parsing and defaults
  _Boundary: Configuration Core_
  _Depends: 1.2_
  _Requirements: 7.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1_
  - Implement option parsing for enabled mode, high-effort behavior, verification gate policy, adversarial review policy, state path, and user-visible notices.
  - Done when valid partial options resolve to documented defaults, invalid options return actionable configuration errors, and disabled mode produces an inert configuration.

## 2. Build Runtime State, Gates, And Degradation Logic

- [ ] 2.1 Implement project-local workflow state storage
  _Boundary: State Store_
  _Depends: 1.2_
  _Requirements: 2.3, 8.1, 8.4, 12.4_
  - Persist minimal workflow state under the project-local open-ultracode state directory, including active mode, phase, assumptions, findings, verification evidence, degradation notices, and completion status.
  - Done when state can be loaded, updated, cleared, and safely recovered from a missing or corrupt state file without writing outside the project directory.

- [ ] 2.2 Implement degradation and phase reporting helpers
  _Boundary: Degradation Core_
  _Depends: 1.2, 1.3_
  _Requirements: 1.3, 7.3, 10.1, 10.2, 10.3_
  - Add helpers that turn unsupported capabilities, unavailable multi-agent execution, failed phases, permission denials, and high-effort limitations into clear user-facing notices with safe next actions.
  - Done when callers can distinguish active, degraded, blocked, and disabled workflow states with consistent messages.

- [ ] 2.3 Implement verification and completion gate logic
  _Boundary: Verification Core_
  _Depends: 1.2, 2.1_
  _Requirements: 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 10.5_
  - Evaluate strict, advisory, and disabled gate policies against acceptance criteria, verification evidence, failed checks, skipped checks, and blocked checks.
  - Done when completion reports accurately classify verified, partial, blocked, failed, and research-only outcomes and explain what evidence is missing.

- [ ] 2.4 Implement adversarial finding reconciliation logic
  _Boundary: Adversarial Core_
  _Depends: 1.2_
  _Requirements: 4.4, 4.5, 5.4, 5.5, 5.6, 10.4_
  - Model findings by severity, confidence, affected requirement, evidence, disposition, and rejection reason, then determine whether required, recommended, or disabled adversarial review policies allow completion.
  - Done when high-confidence unresolved findings block or warn according to policy, and rejected findings require explicit rationale.

## 3. Implement The Plugin Runtime

- [ ] 3.1 Create the plugin entry point and hook factory
  _Boundary: Plugin Runtime_
  _Depends: 1.3, 2.1_
  _Requirements: 9.1, 9.6, 12.1_
  - Export an opencode-compatible plugin function that loads typed options, initializes state access, and returns no operational hooks when disabled.
  - Done when the plugin can be loaded by opencode in enabled and disabled modes without changing the selected provider or model.

- [ ] 3.2 Add session continuity and compaction hooks
  _Boundary: Plugin Runtime_
  _Depends: 2.1, 2.2, 3.1_
  _Requirements: 2.3, 4.6, 10.1, 12.4_
  - Use supported opencode hooks to preserve active workflow mode, phase, assumptions, open findings, verification state, and degradation notices across session compaction or continuation points.
  - Done when compaction context includes the minimal workflow summary needed to resume without exposing unrelated project data.

- [ ] 3.3 Add workflow status and verification tools
  _Boundary: Plugin Tools_
  _Depends: 2.3, 3.1_
  _Requirements: 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 10.5_
  - Provide plugin tools for reading workflow status, recording verification evidence, recording blocked checks, and producing completion reports.
  - Done when the tools report verified, partial, blocked, failed, and research-only states using the same gate logic as the runtime.

- [ ] 3.4 Implement best-effort high-effort request behavior
  _Boundary: High-Effort Adapter_
  _Depends: 1.3, 2.2, 3.1_
  _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 11.5_
  - Apply supported request parameter hints for deeper reasoning, larger output budget, or equivalent provider-supported behavior without claiming hidden reasoning or bypassing provider limits.
  - Done when supported models receive only supported controls, unsupported models produce visible degradation notices, and disabled high-effort mode performs no request mutation.

- [ ] 3.5 Observe tool and permission failures safely
  _Boundary: Plugin Runtime_
  _Depends: 2.2, 3.1_
  _Requirements: 10.3, 12.1, 12.2_
  - Track permission denials and tool failures through supported hooks so workflow phases become blocked instead of retrying unsafe or denied actions.
  - Done when blocked actions are visible in workflow status with the denied operation, affected phase, and safe next step.

## 4. Create The Workflow Prompt Assets

- [ ] 4.1 (P) Create the layered OpenUltraCode skill
  _Boundary: Skill Prompt Asset_
  _Depends: 1.1_
  _Requirements: 2.1, 2.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 10.2_
  - Write the skill that teaches task intake, decomposition, role sequencing, assumption tracking, verification discipline, debug loops, spec-audit loops, and incomplete-spec handling.
  - Done when the skill has valid frontmatter, clear trigger guidance, explicit workflow phases, and fallback behavior for single-session execution.

- [ ] 4.2 (P) Create the workflow slash commands
  _Boundary: Command Prompt Assets_
  _Depends: 1.1_
  _Requirements: 3.2, 3.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.1, 8.2, 8.3, 8.4, 8.5, 10.2_
  - Add commands for comprehensive work, debug, spec audit, adversarial research, and verification, each routing the user's arguments into the right workflow mode.
  - Done when each command has valid frontmatter, accepts `$ARGUMENTS`, names its expected phases, and does not hardcode or override the selected model.

- [ ] 4.3 (P) Create role agent prompts and permissions
  _Boundary: Agent Prompt Assets_
  _Depends: 1.1_
  _Requirements: 1.1, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 12.1, 12.2_
  - Add coordinator, planner, implementer, adversary, reconciler, verifier, and researcher agents with role-specific responsibilities, safe permissions, and no default model overrides.
  - Done when agents can be invoked as subagents, inherit the active selected model unless the user configures otherwise, and produce structured outputs expected by the workflow.

## 5. Add User-Facing Documentation Assets

- [ ] 5.1 Create onboarding, concepts, limits, and configuration documentation
  _Boundary: Documentation Assets_
  _Depends: 1.1, 1.3_
  _Requirements: 1.2, 1.3, 7.4, 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 12.4, 12.5_
  - Document installation, opencode restart requirements, selected-model preservation, differences from UltraCode-Shim, workflow concepts, high-effort limitations, configuration options, permission behavior, and safe troubleshooting.
  - Done when a new user can install the package, understand what it does not do, configure policies, and identify unsupported-provider degradation without reading source code.

## 6. Validate Assets And Core Behavior

- [ ] 6.1 Add asset validation for opencode compatibility
  _Boundary: Asset Validation_
  _Depends: 4.1, 4.2, 4.3_
  _Requirements: 1.1, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 12.1_
  - Implement validation for required skill, command, agent, and plugin assets, valid frontmatter, command names, missing model overrides, and permission constraints.
  - Done when the validation script fails on missing assets, invalid frontmatter, hardcoded model fields, or unsafe permissions.

- [ ] 6.2 Test configuration, state, degradation, verification, and high-effort behavior
  _Boundary: Core Tests_
  _Depends: 1.3, 2.1, 2.2, 2.3, 3.4_
  _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.3, 12.4_
  - Cover valid and invalid configuration, project-local state persistence, degradation messages, strict/advisory/disabled verification gates, and supported or unsupported high-effort request behavior.
  - Done when unit tests fail for unsafe defaults, state writes outside the project, hidden high-effort claims, missing evidence, or unclear degraded-mode messages.

- [ ] 6.3 Test plugin hooks and workflow tools
  _Boundary: Plugin Tests_
  _Depends: 3.1, 3.2, 3.3, 3.5_
  _Requirements: 2.3, 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.6, 10.1, 10.3, 10.5, 12.1, 12.2_
  - Verify plugin disabled behavior, enabled hook registration, compaction summary generation, status tool output, verification evidence recording, blocked permission handling, and completion report classification.
  - Done when tests prove the plugin does not alter selected model configuration and reports blocked or partial states instead of silently completing.

- [ ] 6.4 Test prompt assets against workflow requirements
  _Boundary: Prompt Asset Tests_
  _Depends: 4.1, 4.2, 4.3, 5.1, 6.1_
  _Requirements: 2.1, 2.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.2, 11.1, 11.2, 11.3, 11.4, 11.5_
  - Validate that skills, commands, agents, and docs contain the required workflow phases, adversarial review schema, incomplete-spec behavior, fallback paths, and selected-model constraints.
  - Done when asset tests catch missing phases, missing review verdicts, absent fallback instructions, missing documentation caveats, or model override instructions.

## 7. Integrate And Prove End-To-End Readiness

- [ ] 7.1 Wire the package assets into an installable opencode project layout
  _Boundary: Package Integration_
  _Depends: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1_
  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 9.6, 12.1_
  - Connect the plugin entry point, source modules, skill, commands, agents, validation script, and documentation into the project-local opencode package layout.
  - Done when installing or copying the package assets makes the skill, commands, agents, and plugin discoverable without adding a proxy or replacing the selected model.

- [ ] 7.2 Run end-to-end workflow readiness validation
  _Boundary: End-To-End Validation_
  _Depends: 6.1, 6.2, 6.3, 6.4, 7.1_
  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 10.2, 10.4, 10.5, 12.1, 12.2, 12.3, 12.4, 12.5_
  - Exercise representative comprehensive, debug, spec-audit, adversarial-research, verify, degraded-high-effort, single-session fallback, and strict-gate-blocked flows.
  - Done when validation demonstrates that selected model is preserved, no proxy routes are created, commands route to the expected workflows, unresolved high-confidence findings are handled by policy, and completion cannot be falsely reported without evidence.
