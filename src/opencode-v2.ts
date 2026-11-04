/**
 * Structural types for the OpenCode 2 plugin API surface used by OpenUltraCode.
 *
 * OpenCode 2 loads plugins as `{ id, setup(ctx) }` default exports and exposes
 * domain-scoped hooks (`ctx.session.hook`, `ctx.tool.hook`, ...) instead of the
 * V1 string-keyed hooks object. These types describe only the surface this
 * plugin uses so the package does not need a runtime dependency on
 * `@opencode/plugin`. tests/plugin-contract.test.ts type-checks this surface against the
 * real `@opencode/plugin` types (a devDependency), so drift fails `pnpm run check`.
 */

export interface Registration {
  dispose(): Promise<void>
}

export interface PluginLocation {
  /** The session's working directory; may be a subdirectory of the project. */
  readonly directory: string
  readonly project: {
    readonly directory: string
  }
}

export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export interface PromptDraft {
  text: string
  files?: unknown[]
  agents?: unknown[]
  skills?: unknown[]
}

export interface SessionPromptEvent {
  readonly sessionID: string
  readonly messageID: string
  prompt: PromptDraft
  metadata?: Record<string, unknown>
  delivery: "steer" | "queue"
}

export interface MessagePart {
  readonly type: string
  readonly text?: string
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: MessagePart[]
}

/** Request overrides: typed generation settings plus provider options. Starts empty per model call. */
export interface RequestOptions extends Record<string, unknown> {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  stop?: string[]
}

/** A plain system prompt part (`@opencode/ai` SystemPart). */
export interface SystemPart {
  readonly type: "text"
  readonly text: string
}

export interface SessionRequestEvent {
  readonly sessionID: string
  readonly agent: string
  readonly model: ModelRef
  system: SystemPart[]
  messages: Message[]
  options: RequestOptions
}

export interface SessionContextEvent extends SessionRequestEvent {
  tools: Record<string, unknown>
}

export interface SessionCompactionResult {
  summary: string
  native?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface SessionCompactionEvent extends SessionContextEvent {
  result?: SessionCompactionResult
}

export type SessionHookName = "prompt" | "context" | "compaction"

export interface SessionDomain {
  hook(name: "prompt", callback: (event: SessionPromptEvent) => void | Promise<void>): Promise<Registration>
  hook(
    name: "context" | "compaction",
    callback: (event: SessionContextEvent | SessionCompactionEvent) => void | Promise<void>,
    options?: { providerID?: string }
  ): Promise<Registration>
}

export interface PermissionEvaluationEvent {
  readonly sessionID: string
  readonly agent?: string
  readonly action: string
  readonly resources: readonly string[]
  readonly metadata?: Record<string, unknown>
  /** Set when the evaluation belongs to a tool call. */
  readonly source?: { readonly type: string }
  effect: "allow" | "ask" | "deny"
  message?: string
}

export interface PermissionRequestInfo {
  readonly action: string
  readonly resources: readonly string[]
  readonly message?: string
}

export interface PermissionAssertInput {
  readonly sessionID: string
  readonly agent?: string
  readonly action: string
  readonly resources: readonly string[]
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
}

export interface PermissionDomain {
  hook(name: "evaluate", callback: (event: PermissionEvaluationEvent) => void | Promise<void>): Promise<Registration>
  /** Resolves to the pending request itself (the client unwraps the response body). */
  get(input: { sessionID: string; requestID: string }): Promise<PermissionRequestInfo>
  /** Evaluates permission rules and prompts the user when needed; rejects when denied. */
  assert(input: PermissionAssertInput): Promise<void>
}

export type ToolExecuteAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly input: unknown
} & (
  | { readonly status: "completed"; result: unknown }
  | { readonly status: "error"; error: { readonly message: string } }
)

export interface ToolResult {
  readonly content?: string
  readonly metadata?: Record<string, unknown>
}

export interface ToolExecutionContext {
  readonly signal: AbortSignal
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: Record<string, unknown>
  readonly execute: (input: unknown, context: ToolExecutionContext) => Promise<ToolResult>
}

export interface ToolEditor {
  add(tool: ToolDefinition): void
}

export interface ToolDomain {
  hook(name: "execute.after", callback: (event: ToolExecuteAfterEvent) => void | Promise<void>): Promise<Registration>
  transform(callback: (editor: ToolEditor) => void): Promise<Registration>
}

export interface OpenCodeEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

export interface EventDomain {
  subscribe(options?: { types?: readonly "permission.replied"[]; signal?: AbortSignal }): AsyncIterable<OpenCodeEvent>
}

/** The fields of a model entry (`ctx.model.list()`) the plugin reads. */
export interface ModelInfoSummary {
  readonly id: string
  readonly modelID?: string
  readonly providerID: string
  readonly limit?: { readonly output?: number }
}

export interface ModelDomain {
  list(): Promise<{ readonly data: readonly ModelInfoSummary[] }>
}

export interface OpenCodePluginContext {
  readonly location: PluginLocation
  readonly options: unknown
  readonly session: SessionDomain
  readonly permission: PermissionDomain
  readonly tool: ToolDomain
  readonly event: EventDomain
  readonly model: ModelDomain
}

export interface OpenCodePluginDefinition {
  readonly id: string
  readonly setup: (ctx: OpenCodePluginContext) => Promise<(() => void) | void> | (() => void) | void
}
