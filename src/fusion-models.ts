import type { ModelInfoSummary } from "./opencode-v2.js"

export type FusionModelProblem = "provider-unavailable" | "model-unavailable" | "variant-unavailable"

export interface FusionModelIssue {
  readonly role: string
  readonly reference: string
  readonly problem: FusionModelProblem
  /** Variants opencode reports for the referenced model (empty when it declares none or is not listed). */
  readonly variants: readonly string[]
  /** The best valid replacement from the same provider, when there is one. */
  readonly fallback?: string
  /** Further valid references from the same provider, best first. */
  readonly alternatives: readonly string[]
}

const maxAlternatives = 4

/** Providers of opencode's own hosted catalog; the user's providers are preferred over them. */
const catalogProviders = new Set(["opencode", "opencode-go"])

/**
 * Compares fusion model references with opencode's model list and proposes valid replacements
 * from the same provider. opencode refuses to start an agent whose model or variant it does
 * not know ("Variant unavailable for <model>: max"), so each problem is found before dispatch.
 * Only `provider/model` and `provider/model#max` are proposed, matching the fusion tool.
 */
export function analyzeFusionModels(
  models: readonly ModelInfoSummary[],
  references: Readonly<Record<string, string>>
): FusionModelIssue[] {
  const issues: FusionModelIssue[] = []
  for (const [role, reference] of Object.entries(references)) {
    const parsed = parseReference(reference)
    if (parsed === undefined) continue
    const providerModels = models.filter((model) => model.providerID === parsed.provider)
    if (providerModels.length === 0) {
      // The same model is often offered by another configured provider (for example
      // mistral/mistral-large-4 as vibe-oidc/mistral-large-4); the user's own providers come
      // before opencode's hosted catalog.
      const sameModel = models
        .filter((model) => model.id === parsed.model || model.modelID === parsed.model)
        .sort((a, b) => Number(catalogProviders.has(a.providerID)) - Number(catalogProviders.has(b.providerID)) || a.providerID.localeCompare(b.providerID))
        .map((model) => referenceFor(model, parsed.variant))
      issues.push({ role, reference, problem: "provider-unavailable", variants: [], ...firstAsFallback(sameModel) })
      continue
    }

    const info = providerModels.find((model) => model.id === parsed.model || model.modelID === parsed.model)
    const ranked = rankBySimilarity(providerModels.filter((model) => model !== info), parsed.model, parsed.variant)
    if (info === undefined) {
      const candidates = ranked.map((model) => referenceFor(model, parsed.variant))
      issues.push({ role, reference, problem: "model-unavailable", variants: [], ...firstAsFallback(candidates) })
      continue
    }

    const variants = variantsOf(info)
    if (parsed.variant !== undefined && !variants.includes(parsed.variant)) {
      // Prefer the same model without the variant, then similar models that do declare it.
      const others = ranked.filter((model) => variantsOf(model).includes(parsed.variant ?? "")).map((model) => `${model.providerID}/${model.id}#${parsed.variant}`)
      issues.push({
        role,
        reference,
        problem: "variant-unavailable",
        variants,
        fallback: `${parsed.provider}/${parsed.model}`,
        alternatives: others.slice(0, maxAlternatives)
      })
    }
  }
  return issues
}

function parseReference(reference: string): { provider: string; model: string; variant?: string } | undefined {
  const match = /^([^/#\s]+)\/([^#\s]+)(?:#([^#\s]+))?$/u.exec(reference)
  if (match === null) return undefined
  const [, provider = "", model = "", variant] = match
  return { provider, model, ...(variant === undefined ? {} : { variant }) }
}

function variantsOf(model: ModelInfoSummary): string[] {
  return (model.variants ?? []).map((variant) => variant.id)
}

/** Keeps "#max" only for models that declare it; everything else is referenced without a variant. */
function referenceFor(model: ModelInfoSummary, variant: string | undefined): string {
  const base = `${model.providerID}/${model.id}`
  return variant === "max" && variantsOf(model).includes("max") ? `${base}#max` : base
}

function firstAsFallback(candidates: readonly string[]): Pick<FusionModelIssue, "fallback" | "alternatives"> {
  const [fallback, ...alternatives] = candidates
  return fallback === undefined ? { alternatives: [] } : { fallback, alternatives: alternatives.slice(0, maxAlternatives) }
}

/**
 * Models whose IDs share the longest prefix with the requested one come first ("mistral-large-*");
 * among equally similar models, those declaring the requested variant win.
 */
function rankBySimilarity(models: readonly ModelInfoSummary[], requested: string, variant: string | undefined): ModelInfoSummary[] {
  const score = (id: string) => {
    let shared = 0
    while (shared < id.length && shared < requested.length && id[shared] === requested[shared]) shared += 1
    return shared
  }
  const declares = (model: ModelInfoSummary) => (variant !== undefined && variantsOf(model).includes(variant) ? 1 : 0)
  return [...models].sort((a, b) => score(b.id) - score(a.id) || declares(b) - declares(a) || a.id.localeCompare(b.id))
}

const roleLabels: Readonly<Record<string, { readonly label: string; readonly flag: string }>> = {
  panelA: { label: "Fusion panel A", flag: "--panel-a" },
  panelB: { label: "Fusion panel B", flag: "--panel-b" },
  decider: { label: "Fusion arbiter", flag: "--decider" }
}

export function fusionRoleLabel(role: string): string {
  return roleLabels[role]?.label ?? role
}

export function describeFusionModelIssue(issue: FusionModelIssue): string {
  const role = roleLabels[issue.role] ?? { label: issue.role, flag: `--${issue.role}` }
  const [provider = ""] = issue.reference.split("/")
  const problem =
    issue.problem === "provider-unavailable"
      ? `provider ${provider} is not available in opencode right now (a provider added by a plugin may need an opencode restart)`
      : issue.problem === "model-unavailable"
        ? `opencode does not list this model for provider ${provider}`
        : `opencode reports no "${issue.reference.split("#")[1] ?? ""}" variant for it (${issue.variants.length === 0 ? "it declares no variants" : `it declares ${issue.variants.join(", ")}`})`
  const options = [issue.fallback, ...issue.alternatives].filter((entry): entry is string => entry !== undefined)
  const suggestion = issue.fallback === undefined
    ? "No valid replacement from the same provider was found."
    : `Suggested fallback: ${issue.fallback}${issue.alternatives.length > 0 ? `; other valid choices: ${issue.alternatives.join(", ")}` : ""}.`
  const fix = options.length > 0 ? ` Fix: /ultracode-fusion-models ${role.flag} ${options[0]}.` : ""
  return `${role.label} uses ${issue.reference}, but ${problem}. ${suggestion}${fix}`
}
