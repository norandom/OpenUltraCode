export declare const schemaUrl: string
export declare const fusionPermissionAction: string
export declare const modelIdPattern: RegExp

export declare class InstallerError extends Error {}

export type OpenCodeConfig = Record<string, unknown>

export declare function parseJsonc(text: string, source?: string): OpenCodeConfig
export declare function normalizePluginPath(value: string, platform?: NodeJS.Platform): string
export declare function isOpenUltraCodePluginEntry(entry: unknown): boolean
export declare function withoutOpenUltraCode(config: OpenCodeConfig): OpenCodeConfig
export declare function withOpenUltraCode(config: OpenCodeConfig, pluginPath: string): OpenCodeConfig
export declare function registerPlugin(input: { configDir: string; pluginPath: string; log?: (line: string) => void }): string
export declare function unregisterPlugin(input: { configDir: string; log?: (line: string) => void }): void
export declare function getAgentModel(file: string): string | undefined
export declare function assertModelId(model: unknown): void
export declare function setAgentModel(file: string, model: string): void
export declare function main(argv: readonly string[], log?: (line: string) => void): void
export declare const catalogProviders: ReadonlySet<string>
export declare function parseModelList(text: string): string[]
export declare function configuredModels(config: OpenCodeConfig): string[]
export declare function orderModels(models: readonly string[]): string[]
export declare function listModels(input: {
  configDir: string
  run?: () => { ok: boolean; stdout: string }
  attempts?: number
  delayMs?: number
}): string[]
