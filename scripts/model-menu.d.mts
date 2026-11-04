export declare const customChoice: string
export declare const modelIdPattern: RegExp

export declare function buildChoices(defaultModel: string, candidates: readonly string[]): string[]
export declare function resolveAnswer(answer: string, choices: readonly string[]): { choice: string; error?: undefined } | { error: string; choice?: undefined }
export declare function promptNumbered(input: {
  prompt: string
  choices: readonly string[]
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}): Promise<string>
export declare function selectModel(input: {
  prompt: string
  defaultModel: string
  candidates: readonly string[]
  input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void }
  output?: NodeJS.WritableStream & { columns?: number; rows?: number }
}): Promise<string>
