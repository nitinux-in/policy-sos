// Agent tools: deterministic functions that operate ONLY on the simulated policy dataset.
// The local demo engine (server/agent.ts) decides which tools to run; these functions never invent policy facts.

import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  ActionPlan,
  Category,
  Clause,
  ComparisonResult,
  CostResult,
  CoverageResult,
  EvidenceItem,
  Policy,
  PortfolioData,
} from '../shared/types.js';
import { ACTIVE_CATEGORIES, DEMO_TODAY, scopePortfolio } from '../shared/demo.js';
import { assessHealth, assessLife, orderFactors, sumInsuredUsed, type LifeAssessment, type PolicyAssessment } from './confidence.js';
import { readLifeContext, readSituation, type Person } from './situation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Active product data: health and term life only. Legacy categories in the JSON are never loaded into tools or UI. */
export const portfolio: PortfolioData = scopePortfolio(
  JSON.parse(readFileSync(path.join(here, '..', 'data', 'portfolio.json'), 'utf8')),
);

// ---------- text helpers ----------

const SYNONYMS: Record<string, string[]> = {
  windshield: ['glass', 'windscreen'],
  windscreen: ['glass', 'windshield'],
  heart: ['cardiac'],
  'heart attack': ['cardiac', 'emergency', 'hospitalisation'],
  cardiac: ['heart'],
  dentist: ['dental'],
  teeth: ['dental'],
  tooth: ['dental'],
  hospitalized: ['hospitalisation', 'admitted'],
  hospitalised: ['hospitalisation', 'admitted'],
  admitted: ['hospitalisation'],
  hospital: ['hospitalisation'],
  stolen: ['theft'],
  robbed: ['theft'],
  luggage: ['baggage'],
  car: ['motor'],
  vehicle: ['motor', 'car'],
  bike: ['motor'],
  abroad: ['travel', 'international'],
  japan: ['travel', 'international'],
  trip: ['travel'],
  flight: ['travel'],
  pregnant: ['maternity'],
  pregnancy: ['maternity'],
  dad: ['father', 'parents'],
  father: ['parents'],
  mother: ['parents'],
  mom: ['mother', 'parents'],
  died: ['death'],
  injured: ['accident', 'injury'],
  injury: ['accident'],
  pipe: ['leak'],
  burst: ['leak'],
  'co-pay': ['copay'],
  excess: ['deductible'],
};

const CATEGORY_WORDS: Record<Category, string[]> = {
  health: ['health', 'medical', 'hospital', 'hospitalisation', 'doctor', 'surgery', 'illness', 'cardiac', 'dental', 'maternity', 'medicine'],
  life: ['life', 'term', 'death', 'nominee'],
  motor: ['motor', 'car', 'vehicle', 'windshield', 'glass', 'garage', 'bumper', 'tyre', 'roadside'],
  travel: ['travel', 'trip', 'abroad', 'flight', 'baggage', 'japan', 'international', 'overseas', 'visa'],
  home: ['home', 'house', 'flat', 'apartment', 'burglary', 'leak', 'earthquake'],
  accident: ['accident', 'injury', 'fracture', 'disability'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function expandTerms(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input.join(' ') : input;
  const text = norm(raw);
  const terms = new Set<string>(text.split(' ').filter((t) => t.length > 2));
  for (const [key, extra] of Object.entries(SYNONYMS)) {
    if (text.includes(key)) extra.forEach((e) => terms.add(e));
  }
  // keep multi-word topic phrases that appear verbatim
  terms.add(text);
  return [...terms];
}

function topicHits(clause: Clause, terms: string[]): number {
  let hits = 0;
  for (const topic of clause.topics) {
    const t = norm(topic);
    if (terms.some((term) => term === t || (term.length > 4 && term.includes(t)) || (t.includes(' ') && terms.join(' ').includes(t)))) hits += 1;
  }
  return hits;
}

function clauseScore(clause: Clause, terms: string[]): number {
  let score = topicHits(clause, terms) * 3;
  const hay = norm(`${clause.title} ${clause.text}`);
  for (const term of terms) {
    if (term.length > 3 && !term.includes(' ') && hay.includes(term)) score += 1;
  }
  return score;
}

const INJECTION = /(ignore (all )?(previous|prior|above) instructions|system override|system prompt|you are now|disregard (the )?rules|reveal your|act as)[^.]*\.?/gi;

/** Neutralise instruction-like text inside untrusted documents before it reaches an answer. */
export function sanitizeUntrusted(text: string): string {
  return text.replace(INJECTION, '[instruction-like text removed]');
}

function policyById(id: string): Policy | undefined {
  return portfolio.policies.find((p) => p.id.toLowerCase() === String(id).trim().toLowerCase());
}

const SOURCE = 'Policy document';

export function toEvidence(p: Policy, c: Clause): EvidenceItem {
  return {
    policyId: p.id,
    policyName: p.name,
    provider: p.provider,
    clauseId: c.id,
    section: c.section,
    title: c.title,
    type: c.type,
    text: c.text,
    source: `${SOURCE} · ${p.provider} · ${p.name}, ${c.section}`,
  };
}

function money(p: Policy, n: number): string {
  if (p.currency === 'USD') return `US$${n.toLocaleString('en-US')}`;
  return `₹${n.toLocaleString('en-IN')}`;
}

// ---------- input schemas (validated before every tool run) ----------

const categoryEnum = z.enum(ACTIVE_CATEGORIES);

export const schemas = {
  searchPolicies: z.object({
    query: z.string().max(500).default(''),
    category: categoryEnum.optional(),
  }),
  retrievePolicyEvidence: z.object({
    policyId: z.string().min(1).max(40),
    topics: z.array(z.string().max(80)).max(15).default([]),
  }),
  evaluateCoverage: z.object({
    policyIds: z.array(z.string().max(40)).min(1).max(8),
    scenario: z.string().min(2).max(1000),
    personAffected: z.string().max(80).optional(),
  }),
  comparePolicies: z.object({
    policyIds: z.array(z.string().max(40)).min(2).max(6),
    criteria: z.array(z.string().max(80)).max(10).default([]),
  }),
  calculatePotentialCost: z.object({
    policyId: z.string().min(1).max(40),
    scenario: z.string().max(1000).default(''),
    estimatedBill: z.number().positive().max(1e9).optional(),
    personAffected: z.string().max(80).optional(),
  }),
  generateActionPlan: z.object({
    scenario: z.string().min(2).max(1000),
    policyIds: z.array(z.string().max(40)).max(8).default([]),
    urgent: z.boolean().default(false),
    /** A focused plan for one claim route; omitted = the general plan. */
    mode: z.enum(['cashless', 'planned', 'reimbursement', 'death_claim']).optional(),
    hospital: z.string().max(80).optional(),
  }),
  assessClaimFactors: z.object({
    policyIds: z.array(z.string().max(40)).min(1).max(8),
    scenario: z.string().min(2).max(1000),
    persons: z.array(z.enum(['self', 'spouse', 'son', 'daughter', 'father', 'mother', 'sibling', 'grandparent', 'inlaw', 'other'])).max(4).default([]),
  }),
};

export type ToolName = keyof typeof schemas;

// ---------- tools ----------

export function searchPolicies(args: z.infer<typeof schemas.searchPolicies>) {
  const terms = expandTerms(args.query);
  const results = portfolio.policies
    .filter((p) => !args.category || p.category === args.category)
    .map((p) => {
      let score = 0;
      score += CATEGORY_WORDS[p.category].filter((w) => terms.includes(w)).length * 4;
      if (terms.some((t) => norm(p.name).includes(t) && t.length > 3)) score += 3;
      score += p.clauses.reduce((s, c) => s + Math.min(clauseScore(c, terms), 4), 0);
      if (p.insured.some((i) => terms.some((t) => t.length > 3 && norm(i).includes(t)))) score += 3;
      return { p, score };
    })
    .filter((r) => args.category || r.score > 0 || !args.query.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ p, score }) => ({
      policyId: p.id,
      name: p.name,
      provider: p.provider,
      category: p.category,
      status: p.status,
      sumInsured: money(p, p.sumInsured),
      insured: p.insured,
      renewalDate: p.renewalDate,
      summary: p.summary,
      relevance: score,
    }));
  return {
    matches: results,
    note: results.length === 0 ? 'No policy in the portfolio matched this query.' : undefined,
  };
}

const OVERVIEW_ORDER: Clause['type'][] = ['benefit', 'exclusion', 'waiting_period', 'limit', 'deductible', 'condition', 'claim_process'];

/** Without topics: a balanced overview (taking clauses round-robin by type) so every kind of clause is represented. */
function overview(p: Policy): Clause[] {
  const byType = OVERVIEW_ORDER.map((t) => p.clauses.filter((c) => c.type === t));
  const out: Clause[] = [];
  for (let i = 0; out.length < 8 && byType.some((g) => g.length > i); i++) {
    for (const g of byType) if (g[i] && out.length < 8) out.push(g[i]);
  }
  return out;
}

export function retrievePolicyEvidence(args: z.infer<typeof schemas.retrievePolicyEvidence>) {
  const p = policyById(args.policyId);
  if (!p) return { error: `Unknown policyId "${args.policyId}". Use searchPolicies to get valid IDs.` };
  const terms = expandTerms(args.topics);
  let clauses = args.topics.length
    ? p.clauses
        .map((c) => ({ c, s: clauseScore(c, terms) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => x.c)
    : overview(p);
  const notFound = clauses.length === 0;
  if (notFound) clauses = [];
  const docs = portfolio.documents
    .filter((d) => d.policyId === p.id && !d.trusted)
    .map((d) => ({ title: d.title, trusted: false, text: sanitizeUntrusted(d.text), warning: 'Untrusted user upload — not policy evidence.' }));
  return {
    policy: { policyId: p.id, name: p.name, provider: p.provider, category: p.category, insured: p.insured, status: p.status, policyPeriod: `${p.startDate} to ${p.renewalDate}`, sumInsured: money(p, p.sumInsured), keyFacts: p.keyFacts },
    evidence: clauses.map((c) => toEvidence(p, c)),
    userUploadedDocuments: docs.length ? docs : undefined,
    note: notFound ? `No clause in ${p.name} mentions: ${args.topics.join(', ')}. Treat as not found in policy data, not as confirmed exclusion.` : undefined,
  };
}

const fmtDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Checks a waiting period against the fixed demo date — but only when the sample wording itself
 * states both the length and the date it is counted from. Otherwise it says what is missing.
 */
function waitingPeriodNote(c: EvidenceItem): string {
  const length = c.text.match(/(\d+)\s*(months?|days?)/i);
  const start = c.text.match(/(?:started|since|from)\s+(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (length && start) {
    const end = new Date(start + 'T00:00:00Z');
    if (/month/i.test(length[2])) end.setUTCMonth(end.getUTCMonth() + Number(length[1]));
    else end.setUTCDate(end.getUTCDate() + Number(length[1]));
    const endIso = end.toISOString().slice(0, 10);
    return endIso <= DEMO_TODAY
      ? `${c.title} (${c.section}): the ${length[1]}-${length[2].replace(/s$/, '')} wait counted from ${fmtDay(start)} ended on ${fmtDay(endIso)}, before today (${fmtDay(DEMO_TODAY)}). The insurer still confirms this at claim time.`
      : `${c.title} (${c.section}): the ${length[1]}-${length[2].replace(/s$/, '')} wait counted from ${fmtDay(start)} ends on ${fmtDay(endIso)} — not yet completed as of ${fmtDay(DEMO_TODAY)}.`;
  }
  if (length) return `${c.title} (${c.section}): ${length[1]}-${length[2].replace(/s$/, '')} waiting period. The policy data doesn’t record when this cover started, so completion can’t be checked.`;
  return `${c.title} (${c.section}): a waiting period applies. The policy data can’t show whether it’s over.`;
}

const PERSON_WORDS = ['father', 'mother', 'parents', 'spouse', 'wife', 'husband', 'son', 'daughter', 'child', 'self', 'me'];

function personCovered(p: Policy, person?: string): boolean | undefined {
  if (!person) return undefined;
  const who = norm(person);
  if (['me', 'self', 'myself', 'i'].includes(who)) return p.insured.some((i) => /self|employee|aarav|life assured/i.test(i)) || p.insured.length === 0;
  const map: Record<string, RegExp> = {
    father: /father|parent/i, dad: /father|parent/i, mother: /mother|parent/i, mom: /mother|parent/i,
    parents: /parent|father|mother/i, spouse: /spouse|meera/i, wife: /spouse|meera/i, husband: /spouse/i,
    son: /son|child|kabir/i, daughter: /daughter|child/i, child: /son|daughter|child|kabir/i,
  };
  const key = Object.keys(map).find((k) => who.includes(k));
  if (!key) return p.insured.some((i) => norm(i).includes(who)) ? true : undefined;
  return p.insured.some((i) => map[key].test(i));
}

function detectPerson(text: string): string | undefined {
  const t = norm(text);
  const map: Record<string, string> = { dad: 'father', mom: 'mother', wife: 'spouse', husband: 'spouse' };
  for (const w of [...PERSON_WORDS, 'dad', 'mom']) {
    if (new RegExp(`\\b${w}\\b`).test(t) && !['self', 'me'].includes(w)) return map[w] ?? w;
  }
  return undefined;
}

export function evaluateCoverage(args: z.infer<typeof schemas.evaluateCoverage>) {
  const terms = expandTerms(args.scenario);
  const person = args.personAffected || detectPerson(args.scenario);
  const results: CoverageResult[] = [];
  const unknownIds: string[] = [];
  for (const id of args.policyIds) {
    const p = policyById(id);
    if (!p) { unknownIds.push(id); continue; }
    const scored = p.clauses.map((c) => ({ c, s: clauseScore(c, terms) })).filter((x) => x.s >= 3);
    const supporting = scored.filter((x) => x.c.type === 'benefit').map((x) => toEvidence(p, x.c));
    // An exclusion only counts when its own topics match — not when the situation merely shares words with its text
    const conflicting = scored.filter((x) => x.c.type === 'exclusion' && topicHits(x.c, terms) > 0).map((x) => toEvidence(p, x.c));
    const conditions = scored
      .filter((x) => ['limit', 'waiting_period', 'deductible', 'condition'].includes(x.c.type))
      .map((x) => toEvidence(p, x.c));
    const unknowns: string[] = [];
    let status: CoverageResult['status'];
    let reasoning: string;
    const covered = personCovered(p, person);

    if (covered === false) {
      status = 'Not found';
      reasoning = `${(person ?? "This person").replace(/^./, (c) => c.toUpperCase())} is not insured under this policy.`;
    } else if (supporting.length && !conflicting.length) {
      status = 'Supported';
      reasoning = `Covered under ${supporting.map((s) => s.section).join(', ')}. Conditions apply.`;
    } else if (supporting.length && conflicting.length) {
      status = 'Uncertain';
      reasoning = `Benefit (${supporting.map((s) => s.section).join(', ')}) and exclusion (${conflicting.map((s) => s.section).join(', ')}) both may apply.`;
      unknowns.push('Specific facts that decide whether the exclusion applies');
    } else if (conflicting.length) {
      status = 'Not found';
      reasoning = `Excluded under ${conflicting.map((s) => s.section).join(', ')}.`;
    } else if (conditions.some((c) => c.type === 'limit' || c.type === 'deductible')) {
      // e.g. a room upgrade: not a benefit by itself, but a limit decides what is paid
      const lim = conditions.filter((c) => c.type === 'limit' || c.type === 'deductible');
      status = 'Uncertain';
      reasoning = `Not a benefit on its own, but ${lim.map((c) => `${c.title} (${c.section})`).join(', ')} applies. What is paid depends on the details.`;
    } else if (conditions.some((c) => c.type === 'waiting_period')) {
      // e.g. maternity: only described through a waiting period, so cover depends on time served
      status = 'Uncertain';
      reasoning = `Mentioned only with a waiting period (${conditions.filter((c) => c.type === 'waiting_period').map((c) => c.section).join(', ')}). Cover depends on whether it has been completed.`;
    } else {
      status = 'Not found';
      reasoning = 'No clause covers this situation.';
    }
    if (covered === undefined && person) unknowns.push(`Whether "${person}" is an insured member could not be confirmed`);
    for (const c of conditions.filter((c) => c.type === 'waiting_period')) unknowns.push(waitingPeriodNote(c));
    if (conditions.some((c) => c.type === 'waiting_period' && /pre-existing/i.test(c.title))) unknowns.push('Whether the condition is pre-existing and was declared when the policy was bought');
    if (p.status !== 'active') unknowns.push(`Policy status is "${p.status.replace('_', ' ')}" (renewal date ${p.renewalDate}) — check that the event date falls within the policy period`);
    unknowns.push('Final decision rests with the insurer after documents and assessment');

    // A policy that doesn't insure the affected person contributes no evidence
    if (covered === false) results.push({ policyId: p.id, policyName: p.name, category: p.category, status, reasoning, supporting: [], conflicting: [], conditions: [], unknowns: [] });
    else results.push({ policyId: p.id, policyName: p.name, category: p.category, status, reasoning, supporting, conflicting, conditions, unknowns });
  }
  return { results, personConsidered: person ?? null, invalidPolicyIds: unknownIds.length ? unknownIds : undefined };
}

const CRITERIA_MAP: Record<string, { label: string; topics: string[] }> = {
  sum: { label: 'Sum insured', topics: [] },
  insured: { label: 'Who is covered', topics: [] },
  premium: { label: 'Annual premium', topics: [] },
  renewal: { label: 'Renewal date', topics: [] },
  copay: { label: 'Co-pay / deductible', topics: ['copay', 'co-pay', 'deductible'] },
  room: { label: 'Room rent', topics: ['room rent'] },
  preexisting: { label: 'Pre-existing diseases', topics: ['pre-existing'] },
  maternity: { label: 'Maternity', topics: ['maternity'] },
  cashless: { label: 'Cashless', topics: ['cashless'] },
  dental: { label: 'Dental', topics: ['dental'] },
  cardiac: { label: 'Cardiac treatment', topics: ['cardiac'] },
  exclusions: { label: 'Key exclusions', topics: [] },
};

export function comparePolicies(args: z.infer<typeof schemas.comparePolicies>): ComparisonResult | { error: string } {
  const policies = args.policyIds.map(policyById).filter(Boolean) as Policy[];
  if (policies.length < 2) return { error: 'Need at least two valid policy IDs to compare. Use searchPolicies first.' };
  const sameCategory = new Set(policies.map((p) => p.category)).size === 1;
  let keys = args.criteria.length
    ? Object.keys(CRITERIA_MAP).filter((k) => args.criteria.some((c) => norm(c).includes(k) || norm(CRITERIA_MAP[k].label).includes(norm(c)) || norm(c).includes(norm(CRITERIA_MAP[k].label).split(' ')[0])))
    : [];
  if (keys.length === 0) keys = sameCategory && policies[0].category === 'health'
    ? ['sum', 'insured', 'copay', 'room', 'preexisting', 'maternity', 'cardiac', 'dental']
    : ['sum', 'insured', 'premium', 'renewal', 'exclusions'];
  if (!keys.includes('sum')) keys.unshift('sum');

  const rows = keys.map((k) => {
    const def = CRITERIA_MAP[k];
    return {
      criterion: def.label,
      values: policies.map((p) => {
        if (k === 'sum') return { policyId: p.id, value: money(p, p.sumInsured) };
        if (k === 'insured') return { policyId: p.id, value: p.insured.join(', ') };
        if (k === 'premium') return { policyId: p.id, value: p.premium === 0 ? 'Paid by employer' : money(p, p.premium) };
        if (k === 'renewal') return { policyId: p.id, value: p.renewalDate };
        if (k === 'exclusions') {
          const ex = p.clauses.filter((c) => c.type === 'exclusion').map((c) => c.title);
          return { policyId: p.id, value: ex.length ? ex.join('; ') : 'Not specified in policy data' };
        }
        const terms = expandTerms(def.topics);
        const hit = p.clauses
          .map((c) => ({ c, s: clauseScore(c, terms) }))
          .filter((x) => x.s >= 3)
          .sort((a, b) => b.s - a.s)[0];
        return hit
          ? { policyId: p.id, value: `${hit.c.type === 'exclusion' ? 'Excluded: ' : ''}${hit.c.text}`, clauseId: hit.c.id }
          : { policyId: p.id, value: 'Not specified in policy data' };
      }),
    };
  });
  const notes = ['Values come only from your policy documents. “Not specified” means the policy data doesn’t say. It doesn’t mean the benefit is missing.'];
  if (!sameCategory) notes.push('These policies are in different categories, so they cover different risks and are not substitutes.');
  return {
    criteria: rows.map((r) => r.criterion),
    policies: policies.map((p) => ({ policyId: p.id, policyName: p.name, provider: p.provider })),
    rows,
    notes,
  };
}

export function calculatePotentialCost(args: z.infer<typeof schemas.calculatePotentialCost>): CostResult | { error: string } {
  const p = policyById(args.policyId);
  if (!p) return { error: `Unknown policyId "${args.policyId}".` };
  const cur = p.currency === 'USD' ? 'US$' : '₹';
  const base: CostResult = {
    policyId: p.id,
    policyName: p.name,
    sufficientData: false,
    currency: cur,
    inputs: [],
    lines: [],
    assumptions: [],
    missing: [],
  };
  const bill = args.estimatedBill;
  if (!bill) {
    base.missing.push('Estimated bill / repair quote amount');
    if (p.category === 'motor') base.missing.push('Garage or surveyor repair estimate');
    if (p.category === 'health') base.missing.push('The hospital estimate or final bill, and the room category');
    const fixed = p.clauses.filter((c) => c.type === 'deductible' || (c.type === 'limit' && c.amount));
    base.assumptions.push(...fixed.map((c) => `Known from policy: ${c.title} — ${c.text}`));
    return base;
  }
  const person = args.personAffected || detectPerson(args.scenario);
  base.inputs.push({ label: 'Estimated bill', value: `${cur}${bill.toLocaleString('en-IN')}` });
  let payable = bill;
  let out = 0;
  const terms = expandTerms(args.scenario);

  // sub-limits relevant to the scenario
  for (const c of p.clauses.filter((c) => c.type === 'limit' && c.amount && clauseScore(c, terms) >= 3)) {
    if (c.id === 'HLT-02-3.2') continue; // room rent cap needs room category; handled as assumption
    if (payable > c.amount!) {
      base.lines.push({ label: `Above ${c.title} (${c.section})`, amount: payable - c.amount! });
      out += payable - c.amount!;
      payable = c.amount!;
    }
  }
  // co-pay
  for (const c of p.clauses.filter((c) => c.type === 'deductible' && c.percent)) {
    const applies = /parent/i.test(c.text) ? !!person && /father|mother|parent/.test(person) : true;
    if (applies) {
      const amt = Math.round((payable * c.percent!) / 100);
      base.lines.push({ label: `${c.title} ${c.percent}% (${c.section})`, amount: amt });
      out += amt;
      payable -= amt;
    } else if (/parent/i.test(c.text) && !person) {
      base.missing.push('Who the patient is (parents carry a 20% co-pay)');
    }
  }
  // fixed deductibles
  for (const c of p.clauses.filter((c) => c.type === 'deductible' && c.amount)) {
    const amt = Math.min(c.amount!, payable);
    base.lines.push({ label: `${c.title} (${c.section})`, amount: amt });
    out += amt;
    payable -= amt;
  }
  // Sum insured left this policy year, after claims already paid from it
  const { used, remaining: left } = sumInsuredUsed(p, portfolio.claims); // left stays within [0, sum insured]
  if (payable > left) {
    base.lines.push({ label: used ? 'Above sum insured left this year' : 'Above sum insured', amount: payable - left });
    out += payable - left;
    payable = left;
  }
  base.sufficientData = true;
  base.estimatedOutOfPocket = out;
  base.estimatedInsurerShare = payable;
  base.assumptions.push(
    'Every item on the bill is payable (no non-medical or excluded items).',
    'No limits apply beyond those in the policy data.',
    'The insurer accepts the claim. This is an estimate, not a guarantee.',
  );
  if (p.category === 'health') base.assumptions.push('The room is within the room rent limit. A costlier room would reduce the whole claim.');
  if (used) base.assumptions.push(`₹${used.toLocaleString('en-IN')} of the sum insured was already used by earlier claims this policy year.`);
  if (p.category === 'motor') base.assumptions.push('Zero-depreciation add-on applies, so no depreciation is deducted.');
  return base;
}

export function generateActionPlan(args: z.infer<typeof schemas.generateActionPlan>): ActionPlan {
  const policies = args.policyIds.map(policyById).filter(Boolean) as Policy[];
  if (args.mode) return focusedPlan(args.mode, policies, args.hospital);
  const steps: ActionPlan['steps'] = [];
  const t = norm(args.scenario);
  const medical = /hospital|admit|cardiac|heart|emergency|injur|accident|icu|chest pain|unconscious|bleeding/.test(t);
  if (args.urgent && medical) {
    steps.push({ text: 'Get care first: call 112', detail: 'Don’t wait on insurance to start treatment.' });
  }
  for (const p of policies) {
    const claim = p.clauses.find((c) => c.type === 'claim_process');
    const cashless = p.clauses.find((c) => /cashless/i.test(c.title));
    if (args.urgent && cashless) steps.push({ text: `Request cashless under ${p.name}`, detail: `At the TPA desk · policy no. ${p.policyNumber}` });
    if (claim && !args.urgent) steps.push({ text: `${p.name}: follow the claim process`, detail: `${claim.text} (${claim.section})` });
    if (args.urgent && cashless) steps.push({ text: 'Inform the insurer within 24 hours', detail: p.claimContact });
    if (p.claimContact && !args.urgent) steps.push({ text: `Contact ${p.provider}`, detail: p.claimContact });
    if (p.status !== 'active') steps.push({ text: `Check ${p.name} validity — renews/expires ${p.renewalDate}`, detail: 'Make sure your dates fall within the policy period, or renew before you go.' });
  }
  if (/travel|trip|japan|abroad|international|visa|flight/.test(t) && policies.some((p) => p.category === 'travel')) {
    steps.push({ text: 'Confirm your trip dates fall inside the travel policy period', detail: 'Annual policies only cover trips that start and end before expiry.' });
    steps.push({ text: 'Carry the policy certificate and the 24x7 assistance number', detail: 'Save them offline on your phone and in print.' });
    steps.push({ text: 'Check activities you plan against exclusions', detail: 'e.g. skiing or diving may be excluded.' });
  }
  if (/glass|windshield|windscreen|damage|dent|accident/.test(t) && policies.some((p) => p.category === 'motor')) {
    steps.push({ text: 'Take clear photos of the damage before any repair', detail: 'Do not repair before the insurer survey.' });
  }
  if (policies.length && policies.every((p) => p.category === 'life')) steps.push({ text: 'Keep the policy document and nominee ID ready', detail: 'The nominee needs these to claim.' });
  else steps.push({ text: 'Keep all bills and reports', detail: 'Needed for the claim.' });
  return {
    title: args.urgent ? 'Do this now' : 'Your next steps',
    urgent: args.urgent,
    steps: dedupe(steps).slice(0, 9),
  };
}

/** Short, clause-based steps for one claim route. Only steps that come from the policy data. */
function focusedPlan(mode: 'cashless' | 'planned' | 'reimbursement' | 'death_claim', policies: Policy[], hospital?: string): ActionPlan {
  const p = policies[0];
  const steps: ActionPlan['steps'] = [];
  if (!p) return { title: 'Your next steps', urgent: false, steps };
  const proc = p.clauses.find((c) => c.type === 'claim_process');
  const deadlines = p.clauses.find((c) => c.type === 'condition' && c.topics.includes('intimation'));
  const cashless = p.clauses.find((c) => c.type === 'benefit' && c.topics.includes('cashless'));
  const tpa = /TPA/.test(cashless?.text ?? '') ? 'TPA' : 'insurer';
  const hours = cashless?.text.match(/within (\d+) hours/i)?.[1];
  const preauth = (deadlines?.text ?? cashless?.text ?? '').match(/(\d+) hours before/i)?.[1];
  const days = proc?.text.match(/within (\d+) days of discharge/i)?.[1];
  if (mode === 'cashless') {
    steps.push({ text: `Show your ${p.name} health card at the ${hospital ? `${hospital} ` : 'hospital’s '}insurance (TPA) desk`, detail: `Policy no. ${p.policyNumber} · patient ID` });
    if (hours) steps.push({ text: `Tell the ${tpa === 'TPA' ? 'insurer’s claims desk (TPA)' : 'insurer'} within ${hours} hours of admission`, detail: p.claimContact });
    steps.push({ text: 'Keep the discharge summary, bills and reports', detail: 'You’ll need them if any part is paid as reimbursement.' });
  } else if (mode === 'planned') {
    steps.push({ text: 'Choose a network hospital for cashless', detail: p.clauses.find((c) => c.type === 'condition' && c.topics.includes('network'))?.text });
    steps.push({ text: `Request pre-authorisation${preauth ? ` at least ${preauth} hours before admission` : ''}`, detail: `Through the hospital’s TPA desk · ${p.claimContact ?? p.provider}` });
    steps.push({ text: 'Bring your health card and photo ID on the day' });
  } else if (mode === 'reimbursement') {
    steps.push({ text: 'Gather your documents', detail: proc?.text.replace(/^.*?Reimbursement:\s*/i, '').replace(/^Intimate[^.]*\.\s*/i, '') });
    steps.push({ text: `Submit the claim${days ? ` within ${days} days of discharge` : ''}`, detail: p.claimContact });
    if (/post-hospitalisation bills within (\d+) days/i.test(deadlines?.text ?? '')) steps.push({ text: 'Send follow-up bills separately', detail: deadlines!.text.match(/post-hospitalisation bills within \d+ days[^.]*/i)![0] });
  } else {
    steps.push({ text: `Tell ${p.provider}`, detail: p.claimContact });
    steps.push({ text: 'Submit the claim documents', detail: proc?.text });
    steps.push({ text: 'Track the settlement', detail: p.clauses.find((c) => c.topics.includes('claim settlement'))?.text });
  }
  return { title: 'Your next steps', urgent: false, steps };
}

/** Coverage card for one assessed policy, from its factors. */
function toCoverage(p: Policy, a: PolicyAssessment): CoverageResult {
  const ev = (id?: string) => { const c = id ? p.clauses.find((x) => x.id === id) : undefined; return c ? toEvidence(p, c) : undefined; };
  const clauseIds = [...new Set(a.factors.flatMap((f) => f.clauseIds ?? []))];
  const all = clauseIds.map(ev).filter(Boolean) as EvidenceItem[];
  const main = a.mainClause ? toEvidence(p, a.mainClause) : undefined;
  const status: CoverageResult['status'] = a.outcome === 'covered' ? 'Supported' : a.outcome === 'not_mentioned' ? 'Uncertain' : 'Not found';
  const blocker = a.factors.find((f) => f.status === 'risk' && f.impact !== 'reduces');
  const open = a.factors.filter((f) => f.status === 'check' || f.status === 'unknown');
  const reasoning = a.outcome === 'covered'
    ? `Covered${main ? ` under ${main.section}` : ''}.${a.factors.some((f) => f.status === 'risk') ? ' Deductions apply.' : ''}${open.length ? ` ${open.length} thing${open.length > 1 ? 's' : ''} to check.` : ''}`
    : blocker ? `${blocker.summary}.` : (a.factors.find((f) => f.status === 'unknown')?.summary ?? 'Not covered') + '.';
  return {
    policyId: p.id,
    policyName: p.name,
    category: p.category,
    status,
    reasoning,
    supporting: a.outcome === 'covered' && main && main.type === 'benefit' ? [main] : [],
    conflicting: a.outcome === 'excluded' || a.outcome === 'waiting' ? (main ? [main] : []) : [],
    conditions: a.outcome === 'not_insured' ? [] : all.filter((e) => e.clauseId !== main?.clauseId && e.type !== 'benefit'),
    unknowns: a.outcome === 'not_insured' ? [] : [...open.map((f) => f.summary), 'Final decision rests with the insurer after documents and assessment'],
  };
}

/**
 * Works out every factor that could change a claim for each policy (and each person), from the policy data and
 * the fixed demo date. Health policies get the health checks; term life gets the life checks.
 */
export function assessClaimFactors(args: z.infer<typeof schemas.assessClaimFactors>) {
  const situation = readSituation(args.scenario);
  const persons: Person[] = args.persons.length ? args.persons : situation.persons.length ? situation.persons : ['self'];
  const health: PolicyAssessment[] = [];
  const life: LifeAssessment[] = [];
  const coverage: CoverageResult[] = [];
  for (const id of args.policyIds) {
    const p = policyById(id);
    if (!p) continue;
    if (p.category === 'life') {
      const a = assessLife(p, readLifeContext(args.scenario));
      life.push({ ...a, factors: orderFactors(a.factors) });
      continue;
    }
    for (const person of persons) {
      const a = assessHealth(p, person, { situation, claims: portfolio.claims });
      a.factors = orderFactors(a.factors);
      health.push(a);
      if (person === persons[0]) coverage.push(toCoverage(p, a));
    }
  }
  return { situation, persons, health, life, coverage };
}

function dedupe<T extends { text: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

// ---------- dispatcher ----------

export const TOOL_LABELS: Record<ToolName, string> = {
  searchPolicies: 'Searching your policies',
  retrievePolicyEvidence: 'Reading the relevant clauses',
  evaluateCoverage: 'Checking cover conditions',
  comparePolicies: 'Comparing policies',
  calculatePotentialCost: 'Estimating your share of the bill',
  generateActionPlan: 'Listing your next steps',
  assessClaimFactors: 'Checking waiting periods, disclosure, hospitals and limits',
};

export function runTool(name: string, rawArgs: unknown): { ok: boolean; result: unknown; detail?: string } {
  if (!(name in schemas)) return { ok: false, result: { error: `Unknown tool ${name}` } };
  const parsed = schemas[name as ToolName].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, result: { error: 'Invalid tool input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
  }
  try {
    const a = parsed.data as never;
    switch (name as ToolName) {
      case 'searchPolicies': { const r = searchPolicies(a); return { ok: true, result: r, detail: r.matches.length ? `${r.matches.length} match${r.matches.length > 1 ? 'es' : ''}: ${r.matches.slice(0, 3).map((m) => m.name).join(', ')}` : 'No matching policy' }; }
      case 'retrievePolicyEvidence': { const r = retrievePolicyEvidence(a); return { ok: !('error' in r), result: r, detail: r.evidence && r.policy ? `${r.evidence.length} clause${r.evidence.length === 1 ? '' : 's'} from ${r.policy.name}` : undefined }; }
      case 'evaluateCoverage': { const r = evaluateCoverage(a); return { ok: true, result: r, detail: r.results.map((x) => `${x.policyName}: ${x.status}`).join(' · ') }; }
      case 'comparePolicies': { const r = comparePolicies(a); return { ok: !('error' in r), result: r, detail: 'rows' in r ? `${r.policies.length} policies × ${r.rows.length} criteria` : undefined }; }
      case 'calculatePotentialCost': { const r = calculatePotentialCost(a); return { ok: !('error' in r), result: r, detail: 'sufficientData' in r ? (r.sufficientData ? 'Estimate ready, based on stated assumptions' : 'Not enough detail for an estimate') : undefined }; }
      case 'generateActionPlan': { const r = generateActionPlan(a); return { ok: true, result: r, detail: `${r.steps.length} steps` }; }
      case 'assessClaimFactors': {
        const r = assessClaimFactors(a);
        const all = [...r.health.map((x) => ({ name: x.policyName, fs: x.factors })), ...r.life.map((x) => ({ name: x.policyName, fs: x.factors }))];
        const detail = all.map((x) => `${x.name}: ${x.fs.length} checks${x.fs.some((f) => f.status === 'risk' && f.impact !== 'reduces') ? ', at least 1 could block the claim' : ''}`).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ');
        return { ok: true, result: r, detail };
      }
    }
  } catch (e) {
    return { ok: false, result: { error: `Tool failed: ${(e as Error).message}` } };
  }
  return { ok: false, result: { error: 'Unhandled tool' } };
}
