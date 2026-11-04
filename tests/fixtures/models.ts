import { join } from "node:path"

import { getAgentModel } from "../../scripts/installer-lib.mjs"

// Synthetic providers and models. Tests describe behavior by role (a model that declares a
// max variant, one that declares none, a provider opencode does not offer), never by a real
// provider: results must not depend on which providers a developer or CI machine has.
// tests/no-hardcoded-providers.test.ts keeps real provider names out of the test suite.

export const providers = {
  /** A provider the user configured themselves. */
  user: "provider-user",
  /** A second configured provider that offers some of the same models. */
  other: "provider-other",
  /** A provider opencode does not offer at all. */
  absent: "provider-absent"
} as const

export interface ModelFixture {
  readonly providerID: string
  readonly id: string
  readonly variants: ReadonlyArray<{ readonly id: string }>
  readonly limit?: { readonly output: number }
}

const variants = (...ids: string[]) => ids.map((id) => ({ id }))

/** Models as opencode's `ctx.model.list()` / `opencode api model.list` reports them. */
export const models = {
  /** Declares reasoning variants including max. */
  withMax: { providerID: providers.user, id: "model-family-4", variants: variants("low", "high", "max"), limit: { output: 256000 } },
  /** Same family, declares no variants: any reasoning_effort or variant is rejected. */
  noVariants: { providerID: providers.user, id: "model-family-latest", variants: [], limit: { output: 256000 } },
  /** Same family, also without variants. */
  noVariantsDated: { providerID: providers.user, id: "model-family-2512", variants: [], limit: { output: 256000 } },
  /** A different family that declares max. */
  otherFamilyWithMax: { providerID: providers.user, id: "other-model-5", variants: variants("low", "high", "max"), limit: { output: 131072 } },
  /** The withMax model offered again by a second provider. */
  sameModelOtherProvider: { providerID: providers.other, id: "model-family-4", variants: variants("none", "high") },
  /** A small model with a low output limit that declares only "high". */
  small: { providerID: providers.other, id: "small-model", variants: variants("high"), limit: { output: 8192 } }
} satisfies Record<string, ModelFixture>

export const modelList: readonly ModelFixture[] = Object.values(models)

/** `provider/model` or `provider/model#variant`. */
export function ref(model: ModelFixture, variant?: string): string {
  return `${model.providerID}/${model.id}${variant === undefined ? "" : `#${variant}`}`
}

/** A reference to a model that opencode does not list for a provider it does offer. */
export const unlistedModel = `${providers.user}/model-family-9`

/** A reference whose provider opencode does not offer. */
export const absentProviderModel = `${providers.absent}/some-model`

/** The fusion defaults the repository ships, read from its agent files (never typed in). */
export function shippedFusionDefaults(repoRoot = process.cwd()): Record<"panelA" | "panelB" | "decider", string> {
  const read = (file: string) => {
    const model = getAgentModel(join(repoRoot, "assets", "agents", file))
    if (model === undefined) throw new Error(`${file} ships no model`)
    return model
  }
  return {
    panelA: read("ultracode-fusion-panel-a.md"),
    panelB: read("ultracode-fusion-panel-b.md"),
    decider: read("ultracode-fusion-arbiter.md")
  }
}
