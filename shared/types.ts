// Shared data shapes used by both the server (agent tools) and the app (UI).

export type Category = 'health' | 'life' | 'motor' | 'travel' | 'home' | 'accident';

export type ClauseType =
  | 'benefit'
  | 'exclusion'
  | 'limit'
  | 'waiting_period'
  | 'deductible'
  | 'condition'
  | 'claim_process';

export interface Clause {
  id: string; // e.g. "HLT-01-4.2"
  section: string; // human section reference, e.g. "Section 4.2"
  title: string;
  type: ClauseType;
  topics: string[]; // keywords used for retrieval
  text: string; // simulated clause wording
  amount?: number; // monetary value in policy currency, if any
  percent?: number; // percentage value, if any
}

export interface Policy {
  id: string;
  category: Category;
  provider: string;
  name: string;
  policyNumber: string;
  status: 'active' | 'expiring_soon' | 'lapsed';
  startDate: string;
  renewalDate: string;
  premium: number;
  currency: 'INR' | 'USD';
  sumInsured: number;
  insured: string[];
  summary: string;
  keyFacts: { label: string; value: string }[];
  claimContact?: string;
  clauses: Clause[];
}

export interface PolicyDocument {
  id: string;
  policyId?: string;
  title: string;
  kind: 'policy_wording' | 'schedule' | 'endorsement' | 'user_upload';
  addedOn: string;
  trusted: boolean;
  text: string;
}

export interface PortfolioData {
  disclaimer: string;
  user: { name: string; city: string };
  policies: Policy[];
  documents: PolicyDocument[];
  claims: {
    id: string;
    policyId: string;
    title: string;
    date: string;
    status: 'settled' | 'in_review' | 'closed';
    amountClaimed: number;
    amountSettled?: number;
  }[];
}

// ---------- Agent wire format ----------

export type CoverageStatus = 'Supported' | 'Not found' | 'Uncertain';

export interface EvidenceItem {
  policyId: string;
  policyName: string;
  provider: string;
  clauseId: string;
  section: string;
  title: string;
  type: ClauseType;
  text: string;
  source: string;
}

export interface CoverageResult {
  policyId: string;
  policyName: string;
  category: Category;
  status: CoverageStatus;
  reasoning: string;
  supporting: EvidenceItem[];
  conflicting: EvidenceItem[];
  conditions: EvidenceItem[];
  unknowns: string[];
}

export interface ComparisonResult {
  criteria: string[];
  policies: { policyId: string; policyName: string; provider: string }[];
  rows: { criterion: string; values: { policyId: string; value: string; clauseId?: string }[] }[];
  notes: string[];
}

export interface CostResult {
  policyId: string;
  policyName: string;
  sufficientData: boolean;
  currency: string;
  inputs: { label: string; value: string }[];
  lines: { label: string; amount: number }[];
  estimatedOutOfPocket?: number;
  estimatedInsurerShare?: number;
  assumptions: string[];
  missing: string[];
}

export interface ActionPlan {
  title: string;
  urgent: boolean;
  steps: { text: string; detail?: string }[];
}

export interface AgentStep {
  tool: string;
  label: string; // human readable, e.g. "Searching your policies"
  detail?: string;
  ok: boolean;
}

/**
 * The direct answer, in one glance. `yes`/`no` only when the policy data settles it; `depends` when the answer
 * hinges on something the person must confirm; `info` for explanations with nothing to decide.
 */
export type Verdict = 'yes' | 'likely' | 'partial' | 'depends' | 'unlikely' | 'no' | 'info';

/**
 * How sure the local engine is of its reading of the policy wording, built from explicit checks (never a made-up
 * percentage). Each factor is one thing that could change the outcome at claim time.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type FactorStatus =
  | 'clear' // verified from the policy data, and it supports the answer
  | 'check' // the person needs to confirm something (e.g. "Was the condition declared when you bought the policy?")
  | 'risk' // a known issue in the policy data that can reduce or block the claim
  | 'unknown'; // the policy data doesn't say

export interface ConfidenceFactor {
  id: string; // stable slug, e.g. 'waiting-period', 'disclosure', 'network-hospital'
  label: string; // short, e.g. "Waiting period"
  status: FactorStatus;
  summary: string; // one short line, e.g. "36-month wait for pre-existing conditions ends 1 Jul 2029"
  detail?: string; // longer explanation (markdown), shown on demand
  clauseIds?: string[]; // evidence clauses this factor relies on
  /**
   * For `risk` factors: whether the issue can stop the claim ('blocks', e.g. a waiting period not yet served)
   * or only lowers the payout ('reduces', e.g. a 20% co-pay). Known deductions don't lower confidence.
   */
  impact?: 'blocks' | 'reduces';
}

export interface Confidence {
  level: ConfidenceLevel;
  label: string; // e.g. "High confidence", "Depends on 2 things"
  reason: string; // one line: why this level
  factors: ConfidenceFactor[];
}

/** Longer explanation folded away under the answer (rendered as an accordion item). */
export interface AnswerSection {
  id: string;
  title: string; // e.g. "How a reimbursement claim works"
  summary?: string; // one line shown next to the title
  body: string; // markdown
}

export interface AgentAnswer {
  /** The direct answer in one sentence, e.g. "Yes — Employer Group Health covers your father's admission." */
  headline?: string;
  verdict?: Verdict;
  /** 2–4 short, scannable points: what matters right now. */
  keyPoints?: string[];
  confidence?: Confidence;
  /** Longer explanations, folded away by default. */
  details?: AnswerSection[];
  /** Short body (markdown). Kept brief now that headline/keyPoints carry the answer; may be empty. */
  text: string;
  steps: AgentStep[];
  coverage: CoverageResult[];
  evidence: EvidenceItem[];
  comparison?: ComparisonResult;
  cost?: CostResult[];
  plan?: ActionPlan;
  safetyNotice?: string;
  untrustedNotice?: string; // an untrusted document contained instruction-like text that was removed
  suggestions?: string[]; // follow-up prompts the demo engine supports
}

export type StreamEvent =
  | { type: 'step'; step: AgentStep }
  | { type: 'final'; answer: AgentAnswer }
  | { type: 'error'; message: string };
