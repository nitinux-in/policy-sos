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

export interface AgentAnswer {
  mode: 'ai' | 'demo';
  modeNote?: string;
  text: string;
  steps: AgentStep[];
  coverage: CoverageResult[];
  evidence: EvidenceItem[];
  comparison?: ComparisonResult;
  cost?: CostResult[];
  plan?: ActionPlan;
  safetyNotice?: string;
}

export type StreamEvent =
  | { type: 'step'; step: AgentStep }
  | { type: 'final'; answer: AgentAnswer }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}
