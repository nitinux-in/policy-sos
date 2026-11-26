// Collects the real tool steps and results for one answer, then assembles the AgentAnswer.

import type {
  ActionPlan,
  AgentAnswer,
  AgentStep,
  AnswerSection,
  ComparisonResult,
  Confidence,
  CostResult,
  CoverageResult,
  EvidenceItem,
  Verdict,
} from '../shared/types.js';
import { runTool, TOOL_LABELS, portfolio, toEvidence, type ToolName } from './tools.js';

export const SAFETY_NOW = 'Get care first: call 112 or go to the nearest hospital. Insurance can wait until after admission.';

/**
 * The UI shows the verdict as a chip (Yes / Likely / Partly / Depends / Unlikely / No) before the headline,
 * so a headline starts with the substance, not the verdict word.
 */
function stripVerdict(h?: string): string | undefined {
  if (!h) return h;
  const rest = h.replace(/^(Yes|No|Not yet|Not all of it|Unclear) — /, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export interface Compose {
  headline?: string;
  verdict?: Verdict;
  keyPoints?: string[];
  confidence?: Confidence;
  details?: AnswerSection[];
  suggestions?: string[];
  safetyNotice?: string;
  /** Drop an action plan a tool produced (when the answer itself already says what to do). */
  noPlan?: boolean;
  /** Extra clauses the answer cites (e.g. how to add a member when the person isn't insured). */
  evidenceIds?: string[];
  /** The policy the answer recommends: its coverage card and clauses are listed first. */
  primaryPolicyId?: string;
}

export class Collector {
  steps: AgentStep[] = [];
  evidence = new Map<string, EvidenceItem>();
  coverage = new Map<string, CoverageResult>();
  comparison?: ComparisonResult;
  cost: CostResult[] = [];
  plan?: ActionPlan;
  injectionSeen = false;
  /** Set when part of the question is about insurance outside health and term life. */
  scopeNote?: string;

  constructor(private emit: (s: AgentStep) => void) {}

  note(step: AgentStep) {
    this.steps.push(step);
    this.emit(step);
  }

  call(name: ToolName, args: unknown): any {
    const { ok, result, detail } = runTool(name, args);
    this.note({ tool: name, label: TOOL_LABELS[name], detail: ok ? detail : 'Couldn’t complete this step', ok });
    if (ok) this.absorb(name, result);
    if (JSON.stringify(result).includes('[instruction-like text removed]')) this.injectionSeen = true;
    return result;
  }

  private absorb(name: ToolName, r: any) {
    if (name === 'retrievePolicyEvidence') for (const e of r.evidence ?? []) this.evidence.set(e.clauseId, e);
    if (name === 'evaluateCoverage' || name === 'assessClaimFactors') for (const c of (r.results ?? r.coverage) ?? []) this.coverage.set(c.policyId, c);
    if (name === 'comparePolicies' && r.rows) this.comparison = r;
    if (name === 'calculatePotentialCost' && 'sufficientData' in r) this.cost = [...this.cost.filter((c) => c.policyId !== r.policyId), r];
    if (name === 'generateActionPlan') this.plan = r;
  }

  answer(text: string, o: Compose = {}): AgentAnswer {
    const coverage = [...this.coverage.values()].sort((a, b) => Number(b.policyId === o.primaryPolicyId) - Number(a.policyId === o.primaryPolicyId));
    // Evidence shown = clauses the answer relied on: coverage clauses, then the clauses behind each confidence factor
    let evidence = [...this.evidence.values()];
    const used = new Map<string, EvidenceItem>();
    for (const c of coverage) for (const e of [...c.supporting, ...c.conflicting, ...c.conditions]) used.set(e.clauseId, e);
    for (const id of [...(o.confidence?.factors.flatMap((f) => f.clauseIds ?? []) ?? []), ...(o.evidenceIds ?? [])]) {
      if (used.has(id)) continue;
      const p = portfolio.policies.find((x) => x.clauses.some((c) => c.id === id));
      const c = p?.clauses.find((x) => x.id === id);
      if (p && c) used.set(id, toEvidence(p, c));
    }
    if (used.size) evidence = [...used.values()];
    if (this.scopeNote) text = text ? `${text}\n\n*${this.scopeNote}*` : `*${this.scopeNote}*`;
    const keyPoints = o.keyPoints?.filter(Boolean).slice(0, 4);
    return {
      headline: stripVerdict(o.headline),
      verdict: o.verdict,
      keyPoints: keyPoints?.length ? keyPoints : undefined,
      confidence: o.confidence,
      details: o.details?.length ? o.details : undefined,
      text,
      steps: this.steps,
      coverage,
      evidence: evidence.slice(0, 8),
      comparison: this.comparison,
      cost: this.cost.length ? this.cost : undefined,
      plan: o.noPlan ? undefined : this.plan,
      safetyNotice: o.safetyNotice,
      untrustedNotice: this.injectionSeen
        ? 'An uploaded document had instructions aimed at this assistant. They were removed, and uploads are never used as policy evidence.'
        : undefined,
      suggestions: o.suggestions?.length ? o.suggestions.slice(0, 3) : undefined,
    };
  }

  /**
   * Answers whose content is written as "**Headline.**\n\n- point\n- point": the bold first line becomes the headline,
   * up to four bullets become key points, and any further bullets fold into a details section.
   */
  structured(markdown: string, o: Compose & { moreTitle?: string } = {}): AgentAnswer {
    const [first, ...rest] = markdown.split('\n\n');
    const head = first.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
    const headline = (head ? `${head[1]}${head[2] ? ` ${head[2]}` : ''}` : first).replace(/\*\*/g, '').trim();
    const lines = rest.join('\n').split('\n').map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim().replace(/\*\*/g, ''));
    const prose = lines.filter((l) => !l.startsWith('- ')).join('\n');
    const source = bullets.filter((b) => /^From your policy schedule|^Your insurer decides/.test(b));
    const points = bullets.filter((b) => !source.includes(b));
    const details: AnswerSection[] = [...(o.details ?? [])];
    if (points.length > 4) details.unshift({ id: 'all-items', title: o.moreTitle ?? `All ${points.length} items`, body: points.map((b) => `- ${b}`).join('\n') });
    return this.answer([prose, ...source.map((s) => `*${s}*`)].filter(Boolean).join('\n\n'), {
      ...o,
      headline: o.headline ?? headline,
      verdict: o.verdict ?? 'info',
      keyPoints: o.keyPoints ?? points.slice(0, 4),
      details,
    });
  }
}
