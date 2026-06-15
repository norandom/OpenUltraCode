import type { AdversarialPolicy, CompletionStatus, Finding } from "./types.js"

export interface AdversarialReviewInput {
  readonly policy: AdversarialPolicy
  readonly findings: readonly Finding[]
}

export interface AdversarialReviewReport {
  readonly status: CompletionStatus
  readonly allowsCompletion: boolean
  readonly summary: string
  readonly blockingFindingIds: readonly string[]
  readonly warningFindingIds: readonly string[]
  readonly invalidFindingIds: readonly string[]
  readonly reconciledFindingIds: readonly string[]
  readonly unresolvedRisks: readonly string[]
}

export function evaluateAdversarialReview(input: AdversarialReviewInput): AdversarialReviewReport {
  const invalidFindings = input.findings.filter(isInvalidRejectedFinding)
  const unresolvedFindings = input.findings.filter((finding) => !isReconciled(finding))
  const requiredReconciliationFindings = unresolvedFindings.filter(requiresReconciliation)
  const reconciledFindings = input.findings.filter(isReconciled)

  if (input.policy === "disabled") {
    return {
      status: "research-only",
      allowsCompletion: true,
      summary: "Adversarial review is disabled; no adversarial review pass was claimed.",
      blockingFindingIds: [],
      warningFindingIds: [],
      invalidFindingIds: invalidFindings.map((finding) => finding.id),
      reconciledFindingIds: reconciledFindings.map((finding) => finding.id),
      unresolvedRisks: collectRisks(input.policy, unresolvedFindings, invalidFindings)
    }
  }

  const blockingFindings = input.policy === "required" ? requiredReconciliationFindings : invalidFindings
  const warningFindings = input.policy === "recommended" ? requiredReconciliationFindings : []
  const isBlocked = invalidFindings.length > 0 || blockingFindings.length > 0

  return {
    status: classifyStatus(input.policy, isBlocked, warningFindings),
    allowsCompletion: !isBlocked,
    summary: summarizeReview(input.policy, isBlocked, blockingFindings, warningFindings, invalidFindings),
    blockingFindingIds: uniqueIds(blockingFindings),
    warningFindingIds: uniqueIds(warningFindings),
    invalidFindingIds: uniqueIds(invalidFindings),
    reconciledFindingIds: uniqueIds(reconciledFindings),
    unresolvedRisks: collectRisks(input.policy, unresolvedFindings, invalidFindings)
  }
}

function classifyStatus(
  policy: AdversarialPolicy,
  isBlocked: boolean,
  warningFindings: readonly Finding[]
): CompletionStatus {
  if (isBlocked) {
    return "blocked"
  }

  if (policy === "recommended" && warningFindings.length > 0) {
    return "partial"
  }

  return "verified"
}

function summarizeReview(
  policy: AdversarialPolicy,
  isBlocked: boolean,
  blockingFindings: readonly Finding[],
  warningFindings: readonly Finding[],
  invalidFindings: readonly Finding[]
): string {
  const details = [
    formatDetail("blocking findings", uniqueIds(blockingFindings)),
    formatDetail("warnings", uniqueIds(warningFindings)),
    formatDetail("invalid rejected findings", uniqueIds(invalidFindings))
  ].filter((detail) => detail.length > 0)
  const suffix = details.length > 0 ? ` ${details.join(" ")}` : ""

  if (isBlocked) {
    return `Blocked completion under ${policy} adversarial review policy.${suffix}`
  }

  if (policy === "recommended" && warningFindings.length > 0) {
    return `Partial completion under recommended adversarial review policy; unresolved high- or medium-severity findings remain as warnings.${suffix}`
  }

  return `Adversarial review reconciled under ${policy} adversarial review policy.${suffix}`
}

function collectRisks(
  policy: AdversarialPolicy,
  unresolvedFindings: readonly Finding[],
  invalidFindings: readonly Finding[]
): readonly string[] {
  const risks: string[] = []

  if (policy === "disabled") {
    risks.push("Adversarial review is disabled. Findings are research-only and do not prove review completion.")
  }

  for (const finding of unresolvedFindings) {
    risks.push(`${finding.id} remains unresolved: ${finding.title}.`)
  }

  for (const finding of invalidFindings) {
    risks.push(`${finding.id} was rejected without an explicit rationale.`)
  }

  return Array.from(new Set(risks))
}

function isReconciled(finding: Finding): boolean {
  return finding.disposition === "rejected" && hasDispositionReason(finding)
}

function isInvalidRejectedFinding(finding: Finding): boolean {
  return finding.disposition === "rejected" && !hasDispositionReason(finding)
}

function requiresReconciliation(finding: Finding): boolean {
  return finding.severity === "high" || finding.severity === "medium"
}

function hasDispositionReason(finding: Finding): boolean {
  return typeof finding.dispositionReason === "string" && finding.dispositionReason.trim().length > 0
}

function uniqueIds(findings: readonly Finding[]): readonly string[] {
  return Array.from(new Set(findings.map((finding) => finding.id)))
}

function formatDetail(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return ""
  }

  return `${label}: ${values.join(", ")}.`
}
