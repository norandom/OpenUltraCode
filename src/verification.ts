import type {
  AcceptanceCriterion,
  CompletionReport,
  CompletionStatus,
  GatePolicy,
  VerificationEvidence
} from "./types.js"

export interface CompletionGateInput {
  readonly policy: GatePolicy
  readonly criteria: readonly AcceptanceCriterion[]
  readonly evidence: readonly VerificationEvidence[]
  readonly assumptions?: readonly string[]
  readonly findingIds?: readonly string[]
  readonly researchOnly?: boolean
}

export function evaluateCompletionGate(input: CompletionGateInput): CompletionReport {
  const applicableCriteria = input.criteria.filter((criterion) => criterion.status !== "not-applicable")
  const failed = input.evidence.filter((evidence) => evidence.result === "fail")
  const blocked = input.evidence.filter((evidence) => evidence.result === "blocked")
  const notRun = input.evidence.filter((evidence) => evidence.result === "not-run")
  const missingCriterionIds = applicableCriteria
    .filter((criterion) => !input.evidence.some((evidence) => evidence.result === "pass" && evidence.criteriaIds.includes(criterion.id)))
    .map((criterion) => criterion.id)
  const hasNoGateEvidence = applicableCriteria.length === 0 && input.evidence.length === 0
  const unresolvedRisks = collectUnresolvedRisks(input.criteria, input.evidence, missingCriterionIds, input.policy, hasNoGateEvidence)
  const status = classifyCompletion(input.policy, input.researchOnly === true, missingCriterionIds, failed, blocked, notRun, hasNoGateEvidence)
  const criteria = input.criteria.map((criterion) => classifyCriterion(criterion, input.evidence))

  return {
    status,
    summary: summarizeCompletion(status, input.policy, missingCriterionIds, failed, blocked, notRun, hasNoGateEvidence),
    criteria,
    unresolvedRisks,
    verificationIds: input.evidence.map((evidence) => evidence.id),
    findingIds: input.findingIds ?? [],
    assumptions: input.assumptions ?? []
  }
}

function classifyCompletion(
  policy: GatePolicy,
  researchOnly: boolean,
  missingCriterionIds: readonly string[],
  failed: readonly VerificationEvidence[],
  blocked: readonly VerificationEvidence[],
  notRun: readonly VerificationEvidence[],
  hasNoGateEvidence: boolean
): CompletionStatus {
  if (researchOnly && policy === "disabled") {
    return "research-only"
  }

  if (blocked.length > 0) {
    return "blocked"
  }

  if (failed.length > 0) {
    return "failed"
  }

  if (policy === "disabled") {
    return researchOnly ? "research-only" : "partial"
  }

  if (hasNoGateEvidence) {
    return "partial"
  }

  if (missingCriterionIds.length === 0 && notRun.length === 0) {
    return "verified"
  }

  return "partial"
}

function classifyCriterion(
  criterion: AcceptanceCriterion,
  evidence: readonly VerificationEvidence[]
): AcceptanceCriterion {
  if (criterion.status === "not-applicable") {
    return criterion
  }

  const mappedEvidence = evidence.filter((item) => item.criteriaIds.includes(criterion.id))
  const status = mappedEvidence.some((item) => item.result === "pass") ? "verified" : "unverified"

  return { ...criterion, status }
}

function collectUnresolvedRisks(
  criteria: readonly AcceptanceCriterion[],
  evidence: readonly VerificationEvidence[],
  missingCriterionIds: readonly string[],
  policy: GatePolicy,
  hasNoGateEvidence: boolean
): readonly string[] {
  const risks: string[] = []

  for (const criterionId of missingCriterionIds) {
    const criterion = criteria.find((item) => item.id === criterionId)
    risks.push(`${criterionId} is missing passing verification evidence.${criterion ? ` ${criterion.text}` : ""}`)
  }

  for (const item of evidence) {
    if (item.result === "fail") {
      risks.push(`${item.id} failed: ${item.reason}`)
      risks.push(item.residualRisk)
    } else if (item.result === "blocked") {
      risks.push(`${item.id} was blocked: ${item.reason}`)
      risks.push(item.residualRisk)
    } else if (item.result === "not-run") {
      risks.push(`${item.id} was not run: ${item.reason}`)
      risks.push(item.residualRisk)
    } else if (item.residualRisk !== undefined) {
      risks.push(item.residualRisk)
    }
  }

  if (policy === "disabled" && evidence.length === 0) {
    risks.push("No verification evidence was collected because the gate is disabled.")
  } else if (hasNoGateEvidence) {
    risks.push("No acceptance criteria or verification evidence were provided.")
  }

  return Array.from(new Set(risks))
}

function summarizeCompletion(
  status: CompletionStatus,
  policy: GatePolicy,
  missingCriterionIds: readonly string[],
  failed: readonly VerificationEvidence[],
  blocked: readonly VerificationEvidence[],
  notRun: readonly VerificationEvidence[],
  hasNoGateEvidence: boolean
): string {
  const details = [
    formatDetail("missing evidence", hasNoGateEvidence ? ["workflow verification"] : missingCriterionIds),
    formatDetail("failed checks", failed.map((item) => item.id)),
    formatDetail("blocked checks", blocked.map((item) => item.id)),
    formatDetail("not-run checks", notRun.map((item) => item.id))
  ].filter((detail) => detail.length > 0)
  const suffix = details.length > 0 ? ` ${details.join(" ")}` : ""

  if (status === "verified") {
    return `Verified completion under ${policy} verification policy.${suffix}`
  }

  if (status === "research-only") {
    return `Research-only outcome; verification gate disabled and no completion verification was claimed.${suffix}`
  }

  if (status === "blocked") {
    return `Blocked completion under ${policy} verification policy.${suffix}`
  }

  if (status === "failed") {
    return `Failed completion under ${policy} verification policy.${suffix}`
  }

  return `Partial completion under ${policy} verification policy; unresolved risks remain.${suffix}`
}

function formatDetail(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return ""
  }

  return `${label}: ${values.join(", ")}.`
}
