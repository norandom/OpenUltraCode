export const workflowModes = ["build", "debug", "spec-audit", "adversarial-research", "verify"] as const

export type WorkflowMode = (typeof workflowModes)[number]

export const workflowPhases = [
  "idle",
  "intake",
  "planning",
  "execution",
  "research",
  "adversarial-review",
  "reconciliation",
  "verification",
  "remediation",
  "completed",
  "blocked"
] as const

export type WorkflowPhase = (typeof workflowPhases)[number]

export const gatePolicies = ["strict", "advisory", "disabled"] as const

export type GatePolicy = (typeof gatePolicies)[number]

export const adversarialPolicies = ["required", "recommended", "disabled"] as const

export type AdversarialPolicy = (typeof adversarialPolicies)[number]

export const findingSeverities = ["high", "medium", "low"] as const

export type FindingSeverity = (typeof findingSeverities)[number]

export const findingConfidences = ["high", "medium", "low"] as const

export type FindingConfidence = (typeof findingConfidences)[number]

export const findingDispositions = ["accepted", "rejected", "clarification-needed", "deferred"] as const

export type FindingDisposition = (typeof findingDispositions)[number]

export const acceptanceCriterionSources = ["user", "spec", "inferred"] as const

export type AcceptanceCriterionSource = (typeof acceptanceCriterionSources)[number]

export const acceptanceCriterionStatuses = ["pending", "verified", "unverified", "not-applicable"] as const

export type AcceptanceCriterionStatus = (typeof acceptanceCriterionStatuses)[number]

export const verificationKinds = ["test", "build", "lint", "typecheck", "audit", "manual", "artifact"] as const

export type VerificationKind = (typeof verificationKinds)[number]

export const verificationResults = ["pass", "fail", "not-run", "blocked"] as const

export type VerificationResult = (typeof verificationResults)[number]

export const completionStatuses = ["verified", "partial", "blocked", "failed", "research-only"] as const

export type CompletionStatus = (typeof completionStatuses)[number]

export const degradationSeverities = ["notice", "warning", "blocked"] as const

export type DegradationSeverity = (typeof degradationSeverities)[number]

export const highEffortLevels = ["medium", "high", "xhigh"] as const

export type HighEffortLevel = (typeof highEffortLevels)[number]

export interface AcceptanceCriterion {
  readonly id: string
  readonly text: string
  readonly source: AcceptanceCriterionSource
  readonly status: AcceptanceCriterionStatus
  readonly requirementId?: string
}

interface FindingBase {
  readonly id: string
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly title: string
  readonly evidence: readonly string[]
  readonly impact: string
  readonly recommendation: string
  readonly affectedRequirementIds?: readonly string[]
}

export type Finding =
  | (FindingBase & {
      readonly disposition?: undefined
      readonly dispositionReason?: undefined
    })
  | (FindingBase & {
      readonly disposition: Exclude<FindingDisposition, "rejected">
      readonly dispositionReason?: string
    })
  | (FindingBase & {
      readonly disposition: "rejected"
      readonly dispositionReason: string
    })

interface VerificationEvidenceBase {
  readonly id: string
  readonly kind: VerificationKind
  readonly result: VerificationResult
  readonly summary: string
  readonly criteriaIds: readonly string[]
  readonly command?: string
  readonly artifact?: string
}

export type VerificationEvidence =
  | (VerificationEvidenceBase & {
      readonly result: "pass"
      readonly residualRisk?: string
      readonly reason?: undefined
    })
  | (VerificationEvidenceBase & {
      readonly result: "fail" | "not-run" | "blocked"
      readonly reason: string
      readonly residualRisk: string
    })

export interface DegradationNotice {
  readonly id: string
  readonly capability: string
  readonly severity: DegradationSeverity
  readonly reason: string
  readonly userVisibleMessage: string
  readonly safeNextAction: string
  readonly occurredAt: string
  readonly phase?: WorkflowPhase
}

export interface CompletionReport {
  readonly status: CompletionStatus
  readonly summary: string
  readonly criteria: readonly AcceptanceCriterion[]
  readonly unresolvedRisks: readonly string[]
  readonly verificationIds: readonly string[]
  readonly findingIds: readonly string[]
  readonly assumptions: readonly string[]
}

export interface HighEffortOptions {
  readonly enabled: boolean
  readonly effort: HighEffortLevel
  readonly outputTokens?: number
}

export interface OpenUltraCodeOptions {
  readonly enabled: boolean
  readonly adversarialReview: AdversarialPolicy
  readonly verificationGate: GatePolicy
  readonly highEffort: HighEffortOptions
  readonly state: {
    readonly directory: string
    readonly persistTranscripts: false
  }
  readonly notices: {
    readonly showDegradation: boolean
  }
}

export interface WorkflowState {
  readonly schemaVersion: 1
  readonly sessionId?: string
  readonly mode: WorkflowMode
  readonly phase: WorkflowPhase
  readonly startedAt: string
  readonly updatedAt: string
  readonly goal?: string
  readonly constraints: readonly string[]
  readonly assumptions: readonly string[]
  readonly criteria: readonly AcceptanceCriterion[]
  readonly findings: readonly Finding[]
  readonly verification: readonly VerificationEvidence[]
  readonly degradations: readonly DegradationNotice[]
  readonly completion?: CompletionReport
}

export interface PersistedWorkflowState {
  readonly schemaVersion: 1
  readonly updatedAt: string
  readonly state: WorkflowState
}
