---
description: Show or change the persistent OpenUltraCode fusion role models.
---

Fusion model configuration arguments:

```text
$ARGUMENTS
```

This is a configuration command, not a task workflow. Keep the current selected model unchanged.

Accepted syntax:

```text
/ultracode-fusion-models
/ultracode-fusion-models --panel-a <provider/model[#max]> --panel-b <provider/model[#max]> --decider <provider/model[#max]>
```

Each option is optional, so a command may update one role while preserving the others. Accept a base `provider/model` reference or its `#max` variant. A base reference selects no variant; `#max` selects the model's `max` variant and is valid only for models that declare one. Reject every other variant because variants are applied after agent options and could lower reasoning effort. Also reject duplicate flags, unknown flags, missing values, malformed references, and any attempt to provide credentials or provider configuration.

When arguments are empty, call `open_ultracode_configure_fusion` with `{}` and report the current panel A, panel B, decider, and reasoning effort without changing files.

When arguments request changes:

1. The tool checks every `#max` reference against the variants opencode reports for that model and refuses a variant the model does not declare, naming the variants it does declare. Relay that message instead of retrying with another variant, and suggest the base `provider/model` reference when the model declares no `max` variant.
2. Call `open_ultracode_configure_fusion` exactly once with the requested values as `panelA`, `panelB`, and/or `decider`.
3. Report the configured models, which roles use the `max` variant, changed status, updated directory, and the mandatory restart advice returned by the tool.

Do not edit provider settings, credentials, unrelated agents, or the selected coordinator model. Do not silently substitute a different model.
