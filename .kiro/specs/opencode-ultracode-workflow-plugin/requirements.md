# Requirements Document

## Introduction

OpenUltraCode shall provide a comprehensive UltraCode-style workflow experience for opencode users without requiring the UltraCode-Shim proxy or changing the user's selected opencode model. The feature shall combine user-facing workflow guidance, role-based multi-agent loops, adversarial review, incomplete-spec research, and plugin-enforced session behavior so that opencode sessions can behave closer to UltraCode's deep task execution discipline while remaining native to opencode.

The solution shall adapt the useful workflow concepts demonstrated by UltraCode-Shim, especially task decomposition, role pipelines, adversarial review, verification discipline, and spec research against incomplete requirements. It shall not provide proxy-based backend routing, fake model identifiers, or loopback API translation.

## Boundary Context

- **In scope**: Native opencode workflow mode; layered skill guidance; role-based agent workflows; commands for build, debug, spec audit, and adversarial research; UltraCode-style session reminders; high-effort request behavior where supported by the selected model/provider; verification and review gates; incomplete-spec handling; user-facing status and failure messaging.
- **Out of scope**: Loopback proxy operation; Anthropic-to-OpenAI API translation; model routing across providers; synthetic Claude model IDs; replacing opencode's selected model; recreating Claude Code's private dynamic-workflow engine; bypassing provider limits; guaranteeing hidden reasoning behavior on providers that do not expose it.
- **Adjacent expectations**: OpenUltraCode relies on opencode's existing model selection, agent execution, command execution, plugin hook surface, and permission system. Where opencode or a provider does not support a requested high-effort capability, OpenUltraCode shall degrade visibly rather than silently claiming unsupported behavior.

## Requirements

### Requirement 1: Native Selected-Model Operation
**Objective:** As an opencode user, I want UltraCode-style workflows to use my currently selected model, so that I can improve task execution without changing model routing or running a proxy.

#### Acceptance Criteria
1. When a user enables OpenUltraCode, the system shall preserve the model currently selected in opencode for normal chat, command, and agent execution.
2. The system shall not require a loopback proxy, gateway URL, synthetic model ID, or model alias for core operation.
3. If a workflow requests behavior that the selected model or provider does not support, then the system shall report the unsupported behavior in user-visible terms.
4. While OpenUltraCode is active, the system shall not automatically switch the user's selected model to a different provider or backend.
5. Where a user explicitly changes the selected opencode model, the system shall apply subsequent OpenUltraCode behavior to the newly selected model.

### Requirement 2: UltraCode-Style Session Discipline
**Objective:** As an opencode user, I want sessions to receive consistent UltraCode-style guidance, so that long tasks maintain planning, tool use, verification, and persistence discipline.

#### Acceptance Criteria
1. When OpenUltraCode is active, the system shall add user-visible workflow guidance that emphasizes decomposition, careful tool use, assumption tracking, adversarial review, and verification before completion.
2. When a task begins under OpenUltraCode, the system shall require the workflow to identify the task goal, available context, constraints, and completion criteria before substantial execution.
3. While a workflow is in progress, the system shall preserve phase awareness for planning, execution, review, reconciliation, and verification.
4. If the workflow attempts to finish without verification evidence, then the system shall prompt for or report the missing verification step.
5. The system shall distinguish between direct answers, coding tasks, debugging tasks, research tasks, and spec-audit tasks when selecting the applicable workflow guidance.

### Requirement 3: Layered Workflow Skill
**Objective:** As an opencode user, I want a layered UltraCode skill, so that the model can choose the right workflow pattern for complex work.

#### Acceptance Criteria
1. The system shall provide skill guidance for build, debug, spec-audit, adversarial-research, and general long-task workflows.
2. When a user requests a coding or implementation task, the system shall guide the session through plan, implement, adversarial review, fix, and verify phases.
3. When a user reports a bug or failure, the system shall guide the session through reproduce, isolate, patch, regression test, and verify phases.
4. When a user provides or references a specification, the system shall guide the session to extract explicit claims, identify missing requirements, compare against evidence, and report gaps.
5. When a task is simple enough not to require a full workflow, the system shall allow a shorter path while preserving verification expectations appropriate to the task.

### Requirement 4: Role-Based Multi-Agent Workflows
**Objective:** As an opencode user, I want complex tasks split across specialized roles, so that planning, implementation, adversarial critique, and verification do not collapse into one unchecked pass.

#### Acceptance Criteria
1. When a user starts a comprehensive OpenUltraCode workflow, the system shall decompose the work into role-specific phases for planning, implementation or research, adversarial review, reconciliation, and verification.
2. The system shall provide distinct role guidance for planner, implementer, adversary, verifier, reconciler, and researcher responsibilities.
3. While role-based execution is active, each role shall receive only the task context, constraints, and prior phase outputs needed for its responsibility.
4. If the adversary identifies high- or medium-severity issues, then the system shall require reconciliation before treating those issues as required fixes.
5. If the reconciler rejects an adversarial finding as a false positive, then the system shall require a brief evidence-based reason.
6. When all role phases complete, the system shall summarize the final outcome, unresolved risks, verification evidence, and any assumptions that remain.

### Requirement 5: Adversarial Spec Research
**Objective:** As a user auditing or implementing against specs, I want adversarial research against incomplete or ambiguous specifications, so that hidden gaps and unsafe assumptions are exposed early.

#### Acceptance Criteria
1. When a user invokes spec-audit or adversarial-research mode, the system shall separate explicit requirements, inferred behavior, ambiguous areas, missing information, and assumptions.
2. The system shall treat incomplete specifications as expected inputs rather than errors.
3. When spec evidence conflicts with implementation evidence, the system shall report the conflict with the source of each side of the mismatch.
4. If a requirement cannot be verified from available context, then the system shall label it as unverified rather than satisfied.
5. The system shall produce findings with severity, confidence, evidence, impact, and recommended clarification or remediation.
6. Where user approval is needed to resolve a scope ambiguity, the system shall ask a focused question instead of inventing the missing requirement.

### Requirement 6: Workflow Commands
**Objective:** As an opencode user, I want explicit commands for common UltraCode workflows, so that I can start the right process without manually assembling prompts.

#### Acceptance Criteria
1. The system shall provide a default command for comprehensive task execution.
2. The system shall provide a command for debugging workflows.
3. The system shall provide a command for specification audit workflows.
4. The system shall provide a command for adversarial research workflows.
5. When a command starts, the system shall show the selected workflow mode and the expected phases.
6. If a command is invoked without enough task context, then the system shall ask for the missing user-observable task information.

### Requirement 7: High-Effort Request Behavior
**Objective:** As an opencode user, I want OpenUltraCode to request deeper reasoning and larger useful outputs where supported, so that comprehensive workflows have enough budget to complete.

#### Acceptance Criteria
1. When OpenUltraCode is active and the selected provider supports high-effort controls, the system shall request the configured high-effort behavior.
2. When OpenUltraCode is active and the selected provider supports larger output limits, the system shall request the configured output budget.
3. If a provider rejects or ignores high-effort controls, then the system shall continue the workflow and report that high-effort controls were unavailable when relevant to the user.
4. The system shall not expose hidden chain-of-thought content to the user as a required behavior.
5. Where high-effort behavior is disabled by user configuration, the system shall run workflow guidance without requesting high-effort provider controls.

### Requirement 8: Verification And Completion Gates
**Objective:** As an opencode user, I want completion claims to be gated by evidence, so that the workflow does not declare success without checks.

#### Acceptance Criteria
1. When a workflow modifies files or proposes implementation changes, the system shall require verification evidence before reporting completion.
2. When available verification fails, the system shall report the failure and keep the workflow in a remediation state.
3. If verification cannot be run, then the system shall report why it could not be run and what residual risk remains.
4. The system shall distinguish between verified completion, partial completion, blocked work, and research-only findings.
5. When a task includes acceptance criteria, the system shall map final verification evidence back to those criteria.

### Requirement 9: Configuration And User Control
**Objective:** As an opencode user, I want clear control over OpenUltraCode behavior, so that I can tune workflow strictness without losing normal opencode usage.

#### Acceptance Criteria
1. The system shall allow users to enable or disable OpenUltraCode behavior.
2. The system shall allow users to configure whether adversarial review is required, recommended, or disabled.
3. The system shall allow users to configure whether verification gates are strict, advisory, or disabled.
4. The system shall allow users to configure high-effort and output-budget preferences.
5. When configuration is invalid or unsupported, the system shall report the specific setting and the expected valid behavior.
6. While OpenUltraCode is disabled, the system shall leave normal opencode behavior unchanged.

### Requirement 10: Failure Modes And Degradation
**Objective:** As an opencode user, I want clear degradation when workflow capabilities are unavailable, so that I can trust what OpenUltraCode did and did not do.

#### Acceptance Criteria
1. If opencode does not expose a needed hook or capability, then the system shall report which OpenUltraCode behavior is unavailable.
2. If role-based execution cannot run, then the system shall offer a single-session workflow fallback that preserves the same phase structure.
3. If a workflow phase fails, then the system shall report the failed phase, the reason when known, and the safe next action.
4. The system shall not silently skip adversarial review when the active workflow requires it.
5. The system shall not silently skip verification when the active workflow requires it.

### Requirement 11: Documentation And Onboarding
**Objective:** As a new user, I want clear documentation of OpenUltraCode concepts and limits, so that I understand what it provides and what it does not provide.

#### Acceptance Criteria
1. The system shall document the difference between native OpenUltraCode workflow behavior and proxy-based UltraCode-Shim behavior.
2. The system shall document the difference between a shim, a harness, a skill, an agent, a command, and a plugin in user-facing terms.
3. The system shall provide examples for comprehensive task execution, debugging, spec audit, and adversarial research.
4. The system shall document that OpenUltraCode preserves the currently selected opencode model.
5. The system shall document known limitations for provider-specific high-effort controls and hidden reasoning behavior.

### Requirement 12: Safety, Permissions, And Scope Control
**Objective:** As an opencode user, I want OpenUltraCode workflows to respect existing safety and permission boundaries, so that comprehensive automation does not override my controls.

#### Acceptance Criteria
1. The system shall respect opencode's existing permissions for file edits, command execution, external access, and tool use.
2. When a workflow needs an action blocked by permissions, the system shall request or report the permission boundary according to normal opencode behavior.
3. The system shall not require secrets, provider keys, or credentials beyond those already used by the selected opencode model.
4. The system shall not store task content, specs, or findings outside the user's project or configured opencode storage without user-visible consent.
5. If a workflow handles sensitive or security-relevant findings, then the system shall avoid publishing or externalizing them unless the user explicitly requests it.
