// Deterministic local demo engine.
//
// No AI model or external service is involved. A rule-based resolver maps each message to one
// supported intent, runs a fixed sequence of the local policy tools (server/tools.ts) against the
// simulated portfolio, and composes the answer from the tool results with fixed templates.
// The same message always produces the same answer.

import type {
  ActionPlan,
  AgentAnswer,
  AgentStep,
  Category,
  Clause,
  ComparisonResult,
  CostResult,
  CoverageResult,
  EvidenceItem,
  Policy,
} from '../shared/types.js';
import { runTool, TOOL_LABELS, portfolio, type ToolName } from './tools.js';
import type { ActiveCategory } from '../shared/demo.js';

// ---------- result collection ----------

class Collector {
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
    this.note({ tool: name, label: TOOL_LABELS[name], detail: ok ? detail : 'Could not complete this step', ok });
    if (ok) this.absorb(name, result);
    if (JSON.stringify(result).includes('[instruction-like text removed]')) this.injectionSeen = true;
    return result;
  }

  private absorb(name: ToolName, r: any) {
    if (name === 'retrievePolicyEvidence') for (const e of r.evidence ?? []) this.evidence.set(e.clauseId, e);
    if (name === 'evaluateCoverage') for (const c of r.results ?? []) this.coverage.set(c.policyId, c);
    if (name === 'comparePolicies' && r.rows) this.comparison = r;
    if (name === 'calculatePotentialCost' && 'sufficientData' in r) this.cost = [...this.cost.filter((c) => c.policyId !== r.policyId), r];
    if (name === 'generateActionPlan') this.plan = r;
  }

  answer(text: string, opts: { emergency?: boolean; suggestions?: string[] } = {}): AgentAnswer {
    const coverage = [...this.coverage.values()];
    // Evidence shown = clauses the evaluation relied on; otherwise everything retrieved
    let evidence = [...this.evidence.values()];
    if (coverage.length) {
      const used = new Map<string, EvidenceItem>();
      for (const c of coverage) for (const e of [...c.supporting, ...c.conflicting, ...c.conditions]) used.set(e.clauseId, e);
      if (used.size) evidence = [...used.values()];
    }
    if (this.scopeNote) text += `\n\n*${this.scopeNote}*`;
    return {
      text,
      steps: this.steps,
      coverage,
      evidence: evidence.slice(0, 8),
      comparison: this.comparison,
      cost: this.cost.length ? this.cost : undefined,
      plan: this.plan,
      safetyNotice: opts.emergency ? 'Urgent care first — call 112. Don’t wait for insurance.' : undefined,
      untrustedNotice: this.injectionSeen
        ? 'An uploaded document contains instructions aimed at the assistant. They were removed and treated as untrusted text, not policy evidence.'
        : undefined,
      suggestions: opts.suggestions,
    };
  }
}

// ---------- language cues ----------

const CATEGORY_LABEL: Record<ActiveCategory, string> = {
  health: 'health', life: 'term life',
};

// Only health and term life are supported. Other insurance types are recognised solely so the
// engine can say they are out of scope instead of answering them.
const CATEGORY_CUES: [ActiveCategory, RegExp][] = [
  ['health', /\b(health|medical|hospitali[sz]\w*|hospitals?|admitted|discharged?|surgery|operation|appendix|appendicitis|hernia|broke|broken|fell|doctor|cardiac|heart|dental|dentist|teeth|tooth|maternity|pregnan\w*|delivery|illness|icu|cataract|co-?pay|room rent|pre-?existing|cashless|reimbursement|floater|injur\w*|hurt|fractured?)\b/],
  ['life', /\b(term|life insurance|life cover|life policy|nominee|death|die|died|dies|dead|pass(ed)? away|life assured|sum assured|accidental death|rider|critical illness)\b/],
];
const OUT_OF_SCOPE = /\b(car|motor|vehicle|windshield|windscreen|bumper|bike|scooter|garage|tyres?|tires?|zero depreciation|no-claim bonus|travel\w*|trip|abroad|flights?|baggage|luggage|japan|overseas|visa|home insurance|house|flat|apartment|burglary|burgled|laptop|jewellery|leak\w*|earthquake|personal accident|disability|disabled)\b/;

const INSURANCE_WORDS = /\b(insur\w*|polic(y|ies)|cover\w*|claims?|premiums?|renew\w*|deductible|exclusions?|waiting period|sum insured|benefits?|riders?|cost|pay|bill|compare)\b/;
const EMERGENCY = /\b(emergency|admitted|icu|heart attack|stroke|chest pain|unconscious|collapsed|fainted|seizure|bleeding|injur(ed|y|ies)|hurt|fractured|broke|broken|fell|(is|are|she's|he's|i'm|in) in (the )?hospital)\b/;
const NOT_URGENT = /\b(planned|planning|next month|next year)\b/;
const COMPARE = /\b(compare|comparison|difference|differ|vs|versus|better|best)\b/;
const EXPLAIN = /\b(explain|summari[sz]e|summary|overview|tell me about|walk me through|key (benefits|facts|details|terms)|what does .{1,40} mean)\b/;
const PREPARE = /\b(what should i (check|know)|before (i|we) (go|travel|leave)|preparing for|prepare for)\b/;
const SCENARIO = /\b(covered|cover (me|this|it|my)|can i claim|claim|happened|admitted|hospitali[sz]ed|cracked|stolen|damaged|injur\w*|delayed|lost|(?<!co-)pay)\b/;
const WANTS_COST = /\b(how much|out[- ]of[- ]pocket|cost|costs|(?<!co-)pay|paying|bill|expenses?|my share)\b/;
const WANTS_PLAN = /\b(claim|steps|what should i do|what do i do|next|checklist|how do i)\b/;
const GUARANTEE = /(guarantee|promise|100%|definitely|confirm).{0,40}(approv|pay|cover|claim|settle)/;
const JAILBREAK = /(ignore|forget|disregard|override)\b.{0,30}\b(instructions|rules|prompt|guidelines)|system prompt|developer mode|\bDAN\b|jailbreak|pretend (you are|to be)|act as (an?|my)|you are now|reveal (your|the) (prompt|instructions)|<\/?script|drop table/i;
const ABUSE = /\b(fuck|shit|bitch|bastard|idiot)\b/i;
// Words in key-fact labels too generic to signal that a fact is being asked about
const FACT_STOPWORDS = new Set(['cover', 'covered', 'value', 'insured', 'length', 'per', 'max', 'medical', 'expenses', 'accident', 'accidental', 'life', 'sum']);
// Words that describe the request rather than the policy topic being asked about
const QUESTION_WORDS = new Set(['explain', 'summarise', 'summarize', 'summary', 'overview', 'tell', 'about', 'walk', 'through', 'what', 'does', 'mean', 'means', 'policy', 'policies', 'plan', 'cover', 'key', 'benefits', 'exclusions', 'conditions', 'terms', 'details', 'facts', 'health', 'motor', 'travel', 'home', 'life', 'term', 'accident', 'personal', 'insurance', 'with', 'this', 'that', 'there', 'have']);
const UNSUPPORTED = /\b(buy|purchase|new policy|get a quote|quotes?|sign up|cancel my policy|port my policy|file (a|my) claim for me|submit (a|my) claim|recommend|suggest (a|an|another) (plan|policy)|better (plan|policy|insurance|health insurance)|which (plan|policy) should i (buy|get|take))\b/;
// Questions answered straight from the policy record or one clause type, not by a coverage verdict
const WHO_COVERED = /\bwho('s| is| are)?( all)? (is )?(covered|insured)\b/;
const PERIOD_Q = /\b(when (does|will|do) .{0,30}(end|expire|renew|lapse)|expir(y|es|e)|renewal date|valid (till|until)|cover (till|until)|how long .{0,25}(cover|valid))\b/;
const TOPIC_EXPLAIN = /\b(grace period|missed (my |the )?(\w+ )?premium|premium (is )?(due|unpaid|overdue)|lapsed?|critical illness)\b/;
const TYPE_ASK: [Clause['type'], RegExp, string][] = [
  ['exclusion', /\b(exclusions?|excluded|what('s| is) not covered)\b/, 'Exclusions'],
  ['waiting_period', /\bwaiting periods\b/, 'Waiting periods'],
  ['limit', /\b(limits|sub-?limits)\b/, 'Limits'],
  ['condition', /\bconditions\b/, 'Conditions'],
];
const GREETING = /^(hi|hello|hey|thanks|thank you|ok|okay|cool|great|good (morning|afternoon|evening))\b[\s!.,]*(there)?[\s!.]*$/;
// Plain-language words mapped to the terms the sample clauses use
const EXPANSIONS: [RegExp, string][] = [
  [/\b(die|dies|dead|pass(ed)? away)\b/, 'death'],
  [/\b(appendix|appendicitis|operation|procedure|hernia|gallbladder|knee|hip|fractured?|broke|broken)\b/, 'surgery hospitalisation'],
  [/\b(room upgrade|upgrade (my |the |a )?room|bigger room|private room)\b/, 'room rent'],
  [/\b(premium (is )?(due|unpaid|overdue)|missed (my |the )?(\w+ )?premium)\b/, 'grace premium lapse'],
];

function expand(text: string): string {
  const t = text.toLowerCase();
  return EXPANSIONS.reduce((out, [re, add]) => (re.test(t) ? `${out} ${add}` : out), text);
}
// A plain question about a policy detail ("What is the grace period…?") rather than a situation
const DETAIL_QUESTION = /^(what|who|when|which|how (long|much|many))\b/;
// "my term life policy", "my health insurance" — the policy the question is about
const SUBJECT: [ActiveCategory, RegExp][] = [
  ['life', /\bmy (term life|term|life) (policy|insurance|plan|cover)\b/],
  ['health', /\bmy health (policy|insurance|plan|cover)\b/],
];
// "How do I get cashless?", "How does my nominee make a claim?", "What documents are needed?"
const CLAIM_PROCESS = /\b(how (do|does|can|would|should) (i|we|my \w+|the nominee) (make|file|raise|start|submit|get|do) (a |the )?(claim|cashless)|how (do|can|should) (i|we) claim|claim process|how to claim|claim steps|what documents|documents (are )?(needed|required)|cashless (process|steps|treatment)|reimbursement (claim|process)|what does (the|my) nominee need)\b/;
const FOLLOW_UP = /^(and |what about|how about|same for|also)\b/;
// Words that name the product rather than the situation. They are removed before clause matching so
// that e.g. "my term life policy" doesn't match the term-life death benefit by its name alone.
const GENERIC_WORDS = /\b(my|policy|policies|insurance|plan|life|term|health|cover|covered|does|will|is|it|how|much|cost|costs|extra|me)\b/g;

function toolScenario(message: string): string {
  const s = expand(message).toLowerCase().replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 ? s : message;
}

export const SUGGESTED_PROMPTS = [
  'My father has been admitted after a cardiac emergency. Which policy can help, and what should I do?',
  'Is maternity covered for my wife?',
  'Compare my health policies',
  'Who is the nominee on my term life policy, and what would my family receive?',
];

function detectCategories(t: string): ActiveCategory[] {
  return CATEGORY_CUES.filter(([, re]) => re.test(t)).map(([c]) => c);
}

// Multi-word clause topics ("critical illness", "room rent"). When a question names one, explanations use
// only clauses tagged with that exact topic, so loosely related clauses don't creep in.
const TOPIC_PHRASES = [...new Set(portfolio.policies.flatMap((p) => p.clauses.flatMap((c) => c.topics.filter((x) => x.includes(' ')))))].sort((a, b) => b.length - a.length);
const clauseTopics = (clauseId: string) => portfolio.policies.flatMap((p) => p.clauses).find((c) => c.id === clauseId)?.topics ?? [];

// Name words too common to identify a policy on their own
const GENERIC_NAME_WORDS = new Set(['health', 'shield', 'plus', 'term', 'life', 'policy', 'plan', 'family', 'cover', 'insurance']);

/** Policies the question names, in full ("Family Floater Shield") or by a distinctive word ("floater", "employer"). */
function namedPolicies(t: string): Policy[] {
  return portfolio.policies.filter((p) => {
    const name = p.name.toLowerCase();
    if (t.includes(name)) return true;
    return name.split(/\s+/).some((w) => !GENERIC_NAME_WORDS.has(w) && new RegExp(`\\b${w}\\b`).test(t));
  });
}

function matchedFacts(p: Policy, t: string) {
  return p.keyFacts.filter((f) => {
    const label = f.label.toLowerCase();
    if (t.includes(label)) return true;
    return label.split(/[\s/-]+/).some((w) => w.length > 3 && !FACT_STOPWORDS.has(w) && new RegExp(`\\b${w.replace(/s$/, '')}`).test(t));
  });
}

function parseAmount(text: string): number | undefined {
  const m = text.match(/(?:₹|rs\.?|inr|\$|usd|us\$)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|lac|k)?|([\d,]{3,}(?:\.\d+)?)\s*(lakh|lakhs|lac|k|rupees)?/i);
  if (!m) return undefined;
  const num = parseFloat((m[1] ?? m[3]).replace(/,/g, ''));
  const unit = (m[2] ?? m[4] ?? '').toLowerCase();
  if (!num) return undefined;
  return unit.startsWith('la') ? num * 100000 : unit === 'k' ? num * 1000 : num;
}

function topicWords(message: string): string[] {
  return message.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length > 3).slice(0, 12);
}

const money = (cur: string, n: number) => `${cur}${n.toLocaleString('en-IN')}`;
const fmtIso = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------- intents ----------

type Intent = 'emergency' | 'compare' | 'claim_process' | 'explain' | 'prepare' | 'scenario';

const INTENT_LABEL: Record<Intent, string> = {
  emergency: 'Medical emergency',
  compare: 'Compare policies',
  claim_process: 'How to claim',
  explain: 'Explain policy details',
  prepare: 'Prepare / what to check',
  scenario: 'Coverage check',
};

function resolveIntent(t: string, cats: ActiveCategory[], named: Policy[]): Intent {
  if (EMERGENCY.test(t) && !NOT_URGENT.test(t)) return 'emergency';
  if (COMPARE.test(t)) return 'compare';
  if (CLAIM_PROCESS.test(t)) return 'claim_process';
  if (EXPLAIN.test(t) || WHO_COVERED.test(t) || PERIOD_Q.test(t) || TOPIC_EXPLAIN.test(t)) return 'explain';
  if (TYPE_ASK.filter(([, re]) => re.test(t)).length === 1 && !SCENARIO.test(t.replace(/not covered/, ''))) return 'explain';
  if (PREPARE.test(t)) return 'prepare';
  const targets = named.length ? named : portfolio.policies.filter((p) => (cats as Category[]).includes(p.category));
  if (!SCENARIO.test(t) && (DETAIL_QUESTION.test(t) || targets.some((p) => matchedFacts(p, t).length))) return 'explain';
  return 'scenario';
}

function clarify(col: Collector, head: string): AgentAnswer {
  return col.answer(`${head}\n\nI answer questions about your health and term life policies. Try one of these:`, { suggestions: SUGGESTED_PROMPTS });
}

/** Policies a question is about: named ones, else the detected categories, else the best search matches. */
function pickPolicies(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): string[] | null {
  const search = col.call('searchPolicies', { query: message, category: cats.length === 1 ? cats[0] : undefined });
  const matches: { policyId: string; category: ActiveCategory; relevance: number }[] = search.matches ?? [];
  if (named.length) return named.map((p) => p.id);
  if (cats.length) {
    const ids = matches.filter((m) => cats.includes(m.category)).map((m) => m.policyId);
    for (const p of portfolio.policies) if ((cats as Category[]).includes(p.category) && !ids.includes(p.id)) ids.push(p.id);
    return ids.slice(0, 4);
  }
  if (!matches.length || matches[0].relevance < 6) return null;
  return matches.filter((m) => m.relevance >= matches[0].relevance * 0.5).slice(0, 2).map((m) => m.policyId);
}

function runCompare(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  let ids: string[];
  if (named.length >= 2) ids = named.map((p) => p.id);
  else if (cats.length) ids = portfolio.policies.filter((p) => (cats as Category[]).includes(p.category)).map((p) => p.id).slice(0, 4);
  else return clarify(col, '**Which policies should I compare?**');
  col.call('searchPolicies', { query: message, category: cats.length === 1 ? cats[0] : undefined });
  if (ids.length < 2) {
    const p = portfolio.policies.find((x) => x.id === ids[0])!;
    return col.answer(
      `**You have one ${CATEGORY_LABEL[p.category as ActiveCategory]} policy in your portfolio, so there's nothing to compare it with.**\n\n- Ask me to explain ${p.name} instead.`,
      { suggestions: [`Explain my ${p.name} policy`] },
    );
  }
  const cmp = col.call('comparePolicies', { policyIds: ids, criteria: [] });
  if (!cmp.rows) return col.answer('**I couldn’t build that comparison from your policy data.**');
  const label = cats.length === 1 ? `${CATEGORY_LABEL[cats[0]]} ` : '';
  return col.answer(
    `**Here's how your ${label}policies compare.**\n\n- Each row shows the matching clause from each policy.\n- "Not specified" means the data doesn't say — it is not a confirmed gap.\n- No single policy is "best"; it depends on who needs cover and for what.`,
  );
}

function runExplain(col: Collector, message: string, t: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  const ids = pickPolicies(col, message, cats, named);
  if (!ids?.length) return clarify(col, '**Which policy should I explain?**');
  const targets = ids.slice(0, 2);
  const many = targets.length > 1;
  const policies = targets.map((id) => portfolio.policies.find((p) => p.id === id)!);
  const source = '- From your policy schedule and clauses. Your insurer’s documents are the final word.';

  // Who is insured: straight from the policy record
  if (WHO_COVERED.test(t)) {
    for (const id of targets) col.call('retrievePolicyEvidence', { policyId: id, topics: [] });
    if (!many) return col.answer(`**${policies[0].name} covers ${policies[0].insured.join(', ')}.**\n\n${source}`);
    return col.answer(`**Who each policy covers.**\n\n${policies.map((p) => `- **${p.name}:** ${p.insured.join(', ')}`).join('\n')}\n${source}`);
  }
  // Policy period / when cover ends
  if (PERIOD_Q.test(t)) {
    const lines: string[] = [];
    for (const p of policies) {
      const r = col.call('retrievePolicyEvidence', { policyId: p.id, topics: [] });
      const till = (r.policy?.keyFacts ?? []).filter((f: { label: string }) => /till|expires|until/i.test(f.label));
      lines.push(`- **${p.name}:** current policy period ${fmtIso(p.startDate)} – ${fmtIso(p.renewalDate)}${till.map((f: { label: string; value: string }) => `; ${f.label.toLowerCase()} ${f.value}`).join('')}.`);
    }
    return col.answer(`**${many ? 'Policy periods' : `${policies[0].name}: renews on ${fmtIso(policies[0].renewalDate)}`}.**\n\n${lines.join('\n')}\n${source}`);
  }
  // One clause type ("What are the exclusions…?"): list them
  const typeAsk = TYPE_ASK.filter(([, re]) => re.test(t));
  if (typeAsk.length === 1 && !EXPLAIN.test(t)) {
    const [type, , label] = typeAsk[0];
    const lines: string[] = [];
    for (const p of policies) {
      const r = col.call('retrievePolicyEvidence', { policyId: p.id, topics: [] });
      const items: EvidenceItem[] = (r.evidence ?? []).filter((e: EvidenceItem) => e.type === type);
      if (!items.length) lines.push(`- **${p.name}:** none listed in the policy.`);
      for (const e of items) lines.push(`- ${many ? `**${p.name}** — ` : ''}**${e.title}** (${e.section}): ${e.text}`);
    }
    return col.answer(`**${label} in ${policies.map((p) => p.name).join(' and ')}.**\n\n${lines.join('\n')}\n${source}`);
  }

  // A named multi-word topic across all candidate policies ("Do I have critical illness cover?")
  const phrase = TOPIC_PHRASES.find((ph) => t.includes(ph));
  if (phrase && !EXPLAIN.test(t) && !targets.some((id) => matchedFacts(portfolio.policies.find((p) => p.id === id)!, t).length)) {
    const lines: string[] = [];
    const found: EvidenceItem[] = [];
    for (const id of ids.slice(0, 3)) {
      const r = col.call('retrievePolicyEvidence', { policyId: id, topics: [phrase] });
      const exact: EvidenceItem[] = (r.evidence ?? []).filter((e: EvidenceItem) => clauseTopics(e.clauseId).includes(phrase));
      const name = portfolio.policies.find((p) => p.id === id)!.name;
      if (!exact.length) lines.push(`- **${name}:** no clause about ${phrase}.`);
      for (const e of exact.slice(0, 2)) { found.push(e); lines.push(`- **${name}** — ${e.title} (${e.section}): ${e.text}`); }
    }
    const head = found.length === 1 ? `**${found[0].title} (${found[0].section}).**` : `**What your policies say about ${phrase}.**`;
    return col.answer(`${head}\n\n${lines.join('\n')}\n${source}`);
  }

  const nameWords = new Set(portfolio.policies.flatMap((p) => p.name.toLowerCase().split(/\s+/)));
  const topics = topicWords(expand(message)).filter((w) => !QUESTION_WORDS.has(w.toLowerCase()) && !nameWords.has(w.toLowerCase()));
  const general = EXPLAIN.test(t) && topics.length === 0;
  const lines: string[] = [];
  let head = '';
  for (const id of targets) {
    const r = col.call('retrievePolicyEvidence', { policyId: id, topics: general ? [] : topics });
    if (!r.policy) continue;
    const pol = r.policy;
    const ev: EvidenceItem[] = r.evidence ?? [];
    const facts: { label: string; value: string }[] = general ? [] : matchedFacts(portfolio.policies.find((p) => p.id === id)!, t);
    if (facts.length) {
      if (!head) head = many ? `**Here's what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**` : `**${facts[0].label}: ${facts[0].value}.**`;
      for (const f of facts.slice(many ? 0 : 1)) lines.push(`- ${many ? `${pol.name} — ` : ''}${f.label}: ${f.value}`);
      if (!many && ev[0]) lines.push(`- ${ev[0].title} (${ev[0].section}): ${ev[0].text}`);
    } else if (!general && ev.length) {
      if (!head) head = many ? `**Here's what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**` : `**${ev[0].title} (${ev[0].section}).**`;
      lines.push(`- ${many ? `${pol.name}: ` : ''}${ev[0].text}`);
      // e.g. death benefit + accidental death rider: show a second benefit of the same kind
      if (!many && ev[1] && ev[0].type === 'benefit' && ev[1].type === 'benefit') lines.push(`- Also: ${ev[1].title} (${ev[1].section}): ${ev[1].text}`);
    } else if (!general) {
      lines.push(`- ${pol.name}: not mentioned in the policy.`);
    } else {
      const pick = (types: string[]) => ev.find((e) => types.includes(e.type));
      if (!head) head = targets.length === 1 ? `**${pol.name} at a glance.**` : `**Here's what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**`;
      const prefix = targets.length > 1 ? `${pol.name}: ` : '';
      lines.push(`- ${prefix}Covers ${pol.insured.join(', ')} · ${pol.sumInsured}.`);
      const benefit = pick(['benefit']);
      const exclusion = pick(['exclusion']);
      const watch = pick(['waiting_period', 'deductible', 'limit', 'condition']);
      if (benefit) lines.push(`- ${prefix}Main benefit: ${benefit.title} (${benefit.section}).`);
      if (exclusion) lines.push(`- ${prefix}Key exclusion: ${exclusion.title} (${exclusion.section}).`);
      if (watch && targets.length === 1) lines.push(`- Watch for: ${watch.title} (${watch.section}).`);
    }
  }
  if (!head) return clarify(col, '**I couldn’t find that detail in your policies.** “Not found” here means the data doesn’t say — not that it’s excluded.');
  lines.push(source);
  return col.answer(`${head}\n\n${lines.join('\n')}`);
}

function runPrepare(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  const ids = pickPolicies(col, message, cats, named);
  if (!ids?.length) return clarify(col, '**I couldn’t tell which policy you’re preparing to use.**');
  const lines: string[] = [];
  for (const id of ids.slice(0, 2)) {
    const r = col.call('retrievePolicyEvidence', { policyId: id, topics: [] });
    if (r.policy) for (const f of (r.policy.keyFacts ?? []).slice(0, 3)) lines.push(`- ${f.label}: ${f.value}`);
  }
  col.call('generateActionPlan', { scenario: message, policyIds: ids.slice(0, 2), urgent: false });
  const names = ids.slice(0, 2).map((id) => portfolio.policies.find((p) => p.id === id)!.name).join(' and ');
  return col.answer(`**Here's what to check in ${names}.**\n\n${lines.slice(0, 4).join('\n')}`);
}

function runClaimProcess(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  const ids = pickPolicies(col, message, cats, named);
  if (!ids?.length) return clarify(col, '**Which policy is the claim for — health or term life?**');
  const targets = ids.slice(0, 2);
  const lines: string[] = [];
  for (const id of targets) {
    const r = col.call('retrievePolicyEvidence', { policyId: id, topics: ['claim', 'process', 'documents', 'cashless', 'reimbursement', 'nominee'] });
    const claim: EvidenceItem | undefined = (r.evidence ?? []).find((e: EvidenceItem) => e.type === 'claim_process');
    if (claim) lines.push(`- **${claim.policyName}:** ${claim.text} (${claim.section})`);
  }
  col.call('generateActionPlan', { scenario: message, policyIds: targets, urgent: false });
  const names = targets.map((id) => portfolio.policies.find((p) => p.id === id)!.name).join(' and ');
  if (!lines.length) return col.answer(`**Your policy data doesn’t describe a claim process for ${names}.** Contact the insurer for the steps.`);
  return col.answer(`**How to claim under ${names}.**\n\n${lines.join('\n')}\n- Your insurer decides the claim; these steps come from the policy wording.`);
}

function runScenario(col: Collector, message: string, t: string, cats: ActiveCategory[], named: Policy[], emergency: boolean): AgentAnswer {
  const useCats: ActiveCategory[] = emergency ? ['health'] : cats;
  const ids = pickPolicies(col, message, useCats, named);
  if (!ids?.length) return clarify(col, '**I couldn’t match this to one of your policies.**');

  const scenario = toolScenario(message);
  for (const id of ids) col.call('retrievePolicyEvidence', { policyId: id, topics: topicWords(scenario) });
  const evalRes = col.call('evaluateCoverage', { policyIds: ids, scenario });
  const results: CoverageResult[] = evalRes.results ?? [];
  const relevant = results.filter((r) => r.status !== 'Not found').map((r) => r.policyId);
  const actIds = relevant;

  let costLine = '';
  if (WANTS_COST.test(t) && actIds.length) {
    const c: CostResult = col.call('calculatePotentialCost', { policyId: actIds[0], scenario, estimatedBill: parseAmount(message) });
    if (c?.sufficientData) costLine = `- Estimated out-of-pocket: ${money(c.currency, c.estimatedOutOfPocket ?? 0)} (assumptions below).`;
    else if (c?.missing?.length) costLine = `- For a cost estimate I need: ${c.missing[c.missing.length - 1].toLowerCase()}.`;
  }
  if (emergency || (WANTS_PLAN.test(t) && actIds.length)) col.call('generateActionPlan', { scenario: message, policyIds: actIds, urgent: emergency });

  const best = results.find((r) => r.status === 'Supported') ?? results.find((r) => r.status === 'Uncertain') ?? results[0];
  const disagree = results.some((r) => r.status === 'Supported') && results.some((r) => r.conflicting.length > 0);
  const head = emergency
    ? '**Get medical care first. Then use the insurance steps below.**'
    : disagree
      ? '**Your policies differ on this — check each one below.**'
      : best?.status === 'Supported'
      ? `**Likely covered under ${best.policyName} — conditions apply.**`
      : best?.status === 'Uncertain'
        ? '**Possibly covered — it depends on details the policy data doesn’t settle.**'
        : '**Your policies don’t show cover for this.**';
  const guarantee = GUARANTEE.test(t) ? "**I can't guarantee approval — only your insurer decides.** Here's what the policy data says:\n\n" : '';
  // Each policy's verdict and the conditions to check live on its coverage card (the same result objects
  // the answer carries). The headline text only adds what the cards don't show: policies the app hides
  // because another policy applies, and the cost line.
  for (const r of results) {
    const watch = r.status === 'Not found' && r.supporting.length === 0 && r.conflicting.length === 0
      ? r.conditions.filter((c) => c.type === 'condition')
      : r.conditions.filter((c) => c.type !== 'waiting_period' || r.status === 'Supported');
    const extra = watch.filter((c) => !r.reasoning.includes(c.section));
    if (extra.length) r.reasoning += ` Check: ${extra.slice(0, 2).map((c) => `${c.title} (${c.section})`).join(', ')}.`;
  }
  const shownAsCards = results.some((r) => r.status !== 'Not found') ? results.filter((r) => r.status !== 'Not found') : results;
  const lines = results.filter((r) => !shownAsCards.includes(r)).slice(0, 3).map((r) => `- **${r.policyName}: ${r.status}.** ${r.reasoning}`);
  if (costLine) lines.push(costLine);
  return col.answer(`${guarantee}${head}${lines.length ? `\n\n${lines.join('\n')}` : ''}`, { emergency });
}

// ---------- input checks (run before any tool) ----------

function guard(message: string, insuranceRelated: boolean): AgentAnswer | null {
  const blocked = (text: string, detail: string): AgentAnswer => ({
    text,
    steps: [{ tool: 'guardrail', label: 'Safety check', detail, ok: true }],
    coverage: [],
    evidence: [],
    suggestions: SUGGESTED_PROMPTS,
  });
  const letters = message.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return blocked("**I didn't catch that.**\n\nTry one of these:", 'Unclear input');
  if (/(.)\1{9,}/.test(message) || (letters.length > 20 && !/[aeiou]/i.test(letters))) return blocked("**That doesn't look like a question.**\n\nDescribe what happened in a sentence, or try:", 'Unreadable input');
  if (JAILBREAK.test(message)) return blocked(`**I can't change how I work.**\n\nI only answer from the your ${portfolio.policies.length} health and term life policies. Try:`, 'Manipulation attempt blocked');
  if (ABUSE.test(message) && !insuranceRelated) return blocked("**I'm here to help with your insurance.**\n\nTell me what happened, or try:", 'Abusive input');
  return null;
}

// ---------- entry ----------

export async function runAgent(message: string, emit: (s: AgentStep) => void): Promise<AgentAnswer> {
  const t = message.toLowerCase();
  const subject = SUBJECT.filter(([, re]) => re.test(t)).map(([c]) => c);
  const cats = subject.length ? subject : detectCategories(t);
  const named = namedPolicies(t);
  const outOfScope = OUT_OF_SCOPE.test(t);
  const insuranceRelated = cats.length > 0 || named.length > 0 || outOfScope || INSURANCE_WORDS.test(t);

  const blocked = guard(message, insuranceRelated);
  if (blocked) { emit(blocked.steps[0]); return blocked; }

  const col = new Collector(emit);
  if (FOLLOW_UP.test(t) && cats.length === 0 && named.length === 0) {
    col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: 'Follow-up without context', ok: true });
    return clarify(col, '**Please ask the full question.** I answer each question on its own and don’t carry context from earlier messages — e.g. “Is maternity covered for my wife?”');
  }
  if (GREETING.test(t.trim())) {
    col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: 'Greeting', ok: true });
    return col.answer(`**Hi ${portfolio.user.name.split(' ')[0]}.** I can answer questions about your health and term life policies, with the clause that supports each answer. Try one of these:`, { suggestions: SUGGESTED_PROMPTS });
  }
  if (!insuranceRelated) {
    col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: 'Not an insurance question', ok: true });
    return clarify(col, '**I can only help with your health and term life policies.**');
  }
  if (outOfScope && !cats.length && !named.length) {
    col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: 'Outside health and term life', ok: true });
    return clarify(col, '**I cover health and term life insurance only.** I can’t answer questions about car, travel, home or personal accident insurance.');
  }
  if (UNSUPPORTED.test(t)) {
    col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: 'Not supported', ok: true });
    return clarify(col, '**I can’t buy, change or file anything with an insurer.** I only explain the policies already in your portfolio.');
  }
  if (outOfScope) col.scopeNote = 'I cover health and term life only, so any car, travel, home or personal accident part of the question isn’t answered.';
  const intent = resolveIntent(t, cats, named);
  col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail: INTENT_LABEL[intent], ok: true });

  switch (intent) {
    case 'compare': return runCompare(col, message, cats, named);
    case 'claim_process': return runClaimProcess(col, message, cats, named);
    case 'explain': return runExplain(col, message, t, cats, named);
    case 'prepare': return runPrepare(col, message, cats, named);
    case 'emergency': return runScenario(col, message, t, cats, named, true);
    default: return runScenario(col, message, t, cats, named, false);
  }
}
