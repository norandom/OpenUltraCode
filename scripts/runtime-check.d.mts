export declare const fusionAgents: readonly string[]

export interface ModelListEntry {
  readonly id: string
  readonly modelID?: string
  readonly providerID: string
  readonly variants?: ReadonlyArray<{ readonly id: string }>
}

export declare function fetchModelList(
  run?: (args: readonly string[]) => { ok: boolean; stdout: string; stderr: string },
  options?: { attempts?: number; delayMs?: number }
): ModelListEntry[]
export declare function readInstalledModels(configDir: string): { coordinator: string | undefined; agents: Record<string, string | undefined> }
export declare function checkReferences(models: readonly ModelListEntry[], references: Readonly<Record<string, string | undefined>>): string[]
export declare function parseRunEvents(output: string): {
  subagents: Array<{ agent?: string; status?: string; childSessionID?: string; error?: string }>
  errors: string[]
}
export declare function checkSubagentSession(agent: string, reference: string, exported: unknown): string[]
export declare function runtimeCheck(input: { configDir: string; live?: boolean; log?: (line: string) => void }): {
  installed: { coordinator: string | undefined; agents: Record<string, string | undefined> }
  problems: string[]
}
