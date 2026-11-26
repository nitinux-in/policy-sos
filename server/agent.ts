// Deterministic local demo engine.
//
// No AI model or external service is involved. A rule-based router reads each message into a situation
// (server/situation.ts), picks one supported kind of answer, runs the local policy tools (server/tools.ts)
// against the sample portfolio, and composes a structured answer: a one-sentence headline, up to four key
// points, a confidence rating built from explicit claim factors (server/confidence.ts), and details folded
// into sections (server/scenarios.ts). The same message always produces the same answer.

import type { AgentAnswer, AgentStep, Category, Clause, EvidenceItem, Policy } from '../shared/types.js';
import { portfolio } from './tools.js';
import { Collector } from './collector.js';
import { clauseWith, fmtDate, inr } from './confidence.js';
import { readLifeContext, readSituation } from './situation.js';
import { runHealth, runHealthTopic, runLife, type HealthTopic, type LifeTopic } from './scenarios.js';
import type { ActiveCategory } from '../shared/demo.js';

// ---------- language cues ----------

const CATEGORY_LABEL: Record<ActiveCategory, string> = { health: 'health', life: 'term life' };

// Only health and term life are supported. Other insurance types are recognised solely so the
// engine can say they are out of scope instead of answering them.
const CATEGORY_CUES: [ActiveCategory, RegExp][] = [
  ['health', /\b(health|medical|hospitali[sz]\w*|hospitals?|admitted|discharged?|surgery|operation|appendix|appendicitis|hernia|broke|broken|fell|doctor|cardiac|heart|dental|dentist|teeth|tooth|maternity|pregnan\w*|delivery|illness|icu|cataract|co-?pay|room rent|pre-?existing|cashless|reimburs\w*|floater|injur\w*|hurt|fractured?|diabet\w*|thyroid|asthma|dengue|cancer|knee|opd|ambulance|bp|blood pressure|hypertension|chest pain|unconscious|fever|mental|depression|dialysis|chemo\w*|sum insured|tpa|network)\b/],
  ['life', /\b(term|life insurance|life cover|life policy|nominee|death|die|died|dies|dead|pass(ed)? away|life assured|sum assured|accidental death|rider|critical illness|suicide|section 45)\b/],
];
const OUT_OF_SCOPE = /\b(car|motor|vehicle|windshield|windscreen|bumper|bike|scooter|garage|tyres?|tires?|zero depreciation|no-claim bonus|travel insurance|travel policy|trip|flights?|baggage|luggage|japan|visa|home insurance|house|flat|apartment|burglary|burgled|laptop|jewellery|leak\w*|earthquake|personal accident|disability|disabled)\b/;
const INSURANCE_WORDS = /\b(insur\w*|polic(y|ies)|cover\w*|claims?|premiums?|renew\w*|deductible|exclusions?|waiting period|sum insured|benefits?|riders?|cost|pay|bill|compare|nominee|port)\b/;
const COMPARE = /\b(compare|comparison|difference|differ|vs|versus|better|best)\b/;
const EXPLAIN = /\b(explain|summari[sz]e|summary|overview|tell me about|walk me through|key (benefits|facts|details|terms)|what does .{1,40} mean)\b/;
const PREPARE = /\b(what should i (check|know)|before (i|we) (go|travel|leave)|preparing for|prepare for)\b/;
const JAILBREAK = /(ignore|forget|disregard|override)\b.{0,30}\b(instructions|rules|prompt|guidelines)|system prompt|developer mode|\bDAN\b|jailbreak|pretend (you are|to be)|act as (an?|my)|you are now|reveal (your|the) (prompt|instructions)|<\/?script|drop table/i;
const ABUSE = /\b(fuck|shit|bitch|bastard|idiot)\b/i;
const FACT_STOPWORDS = new Set(['cover', 'covered', 'value', 'insured', 'length', 'per', 'max', 'medical', 'expenses', 'accident', 'accidental', 'life', 'sum']);
const QUESTION_WORDS = new Set(['explain', 'summarise', 'summarize', 'summary', 'overview', 'tell', 'about', 'walk', 'through', 'what', 'does', 'mean', 'means', 'policy', 'policies', 'plan', 'cover', 'key', 'benefits', 'exclusions', 'conditions', 'terms', 'details', 'facts', 'health', 'motor', 'travel', 'home', 'life', 'term', 'accident', 'personal', 'insurance', 'with', 'this', 'that', 'there', 'have']);
const UNSUPPORTED = /\b(buy|purchase|new policy|get a quote|quotes?|sign up|cancel my policy|file (a|my) claim for me|submit (a|my) claim for me|recommend|suggest (a|an|another) (plan|policy)|better (plan|policy|insurance|health insurance)|which (plan|policy) should i (buy|get|take))\b/;
const WHO_COVERED = /\bwho('s| is| are)?( all)? (is )?(covered|insured)\b/;
const PERIOD_Q = /\b(when (does|will|do) .{0,30}(end|expire|renew|lapse)|expir(y|es|e)|renewal date|valid (till|until)|cover (till|until)|how long .{0,25}(cover|valid))\b/;
const TYPE_ASK: [Clause['type'], RegExp, string][] = [
  ['exclusion', /\b(exclusions?|excluded|what('s| is) not covered)\b/, 'Exclusions'],
  ['waiting_period', /\bwaiting periods\b/, 'Waiting periods'],
  ['limit', /\b(limits|sub-?limits)\b/, 'Limits'],
  ['condition', /\bconditions\b/, 'Conditions'],
];
const GREETING = /^(hi|hello|hey|hii+|namaste|thanks|thank you|thx|ok|okay|cool|great|good (morning|afternoon|evening))\b[\s!.,]*(there)?[\s!.]*$/;
const EXPANSIONS: [RegExp, string][] = [
  [/\b(die|dies|dead|pass(ed)? away)\b/, 'death'],
  [/\b(appendix|appendicitis|operation|procedure|hernia|gallbladder|knee|hip|fractured?|broke|broken)\b/, 'surgery hospitalisation'],
  [/\b(room upgrade|upgrade (my |the |a )?room|bigger room|private room)\b/, 'room rent'],
  [/\b(premium (is )?(due|unpaid|overdue)|missed (my |the )?(\w+ )?premium)\b/, 'grace premium lapse'],
];
const DETAIL_QUESTION = /^(what|who|when|which|how (long|much|many))\b/;
const SUBJECT: [ActiveCategory, RegExp][] = [
  ['life', /\bmy (term life|term|life) (policy|insurance|plan|cover)\b/],
  ['health', /\bmy (health|medical) (policy|insurance|plan|cover)\b/],
];
const FOLLOW_UP = /^(and |what about|how about|same for|also)\b/;
const VAGUE = /^(is (it|this|that) covered|am i covered|are we covered|can i claim( it| this)?|will (insurance|it|they) pay|does (it|my policy|insurance) cover (it|this|that)|what('s| is) covered|is this claimable|covered\??)[\s?!.]*$/;

// Life sub-topics
const LIFE_NO_HEALTH = /\b(hospitali[sz]\w*|hospital|critical illness|cancer|illness|treatment|surgery|medical)\b/;
const NOMINEE_CHANGE = /\b((change|update|add|replace|remove|switch) .{0,20}nominee|nominee .{0,20}(change|update)|new nominee)\b/;
const LIFE_CLAIM = /\b(how (do|does|can|would|will|should) (i|we|my \w+|the nominee) (make|file|raise|start|submit|get|do) (a |the )?claim|how (do|can|should) (i|we|my \w+) claim|claim process|how to claim|claim steps|what documents|documents (are )?(needed|required)|what does (the|my) nominee need)\b/;
const PREMIUM_DUE = /\b(when (is|are|do|does|will|should|must) .{0,30}\bpremiums?\b|premiums? (is |are )?due|(premium|payment) due date|due date .{0,20}premium|next (term |life )?premium|pay .{0,20}premium .{0,10}(by|when|next)|premium (date|schedule))\b/;
const RIDER_Q = /\b(rider|riders)\b/;
const DEATH_Q = /\b(die|dies|died|death|dead|pass(ed)? away|payout|receive|get|family|nominee)\b/;
const GUARANTEE_ONLY = /(guarantee|promise|100%|definitely|assure).{0,40}(approv|pay|settle)|every claim .{0,20}approved/;
const REJECTED = /\b(reject\w*|denied|repudiat\w*|refused|short-?settled|not (paid|approved|settled)|declined|appeal|ombudsman|grievance|complain\w*)\b/;

// Health sub-topics answered from one or two clauses
const HEALTH_TOPICS: [HealthTopic, RegExp][] = [
  ['job', /\b(leave (my |the )?job|leaving (my |the )?job|resign\w*|quit (my )?job|change (my )?jobs?|lose (my )?job|laid off|switch(ing)? jobs?|employment ends)\b/],
  ['portability', /\b(port|porting|portability|switch (my )?(insurer|insurance company)|move (my )?policy to)\b/],
  ['add_member', /\b(add|adding|include|enrol+)\b.{0,40}\b(policy|insurance|cover|plan|floater|mother|father|mom|dad|parents|wife|husband|baby|newborn|child|in-?laws?)\b|\bnew ?born\b/],
  ['rejected', REJECTED],
  ['disclosure', /\b((didn'?t|did not|never|not|forgot to) (declare|disclose|tell|mention)|non-?disclosure|undeclared|undisclosed|wasn'?t declared|hid)\b/],
  ['sum_left', /\b((sum insured|cover|coverage|amount|limit) (is |do i have |have i got |i have )?(left|remaining|available|balance)|(balance|remaining) (sum insured|cover|health cover)|how much (health |medical )?(cover|coverage|sum insured|insurance)\b.{0,25}\b(left|remaining)|how much of (my|the|our) (health |medical )?(cover|coverage|sum insured|insurance|policy limit)\b.{0,25}\b(left|remaining|used))\b/],
  ['network', /\b(which hospitals|cashless hospitals?|network hospitals?|list of hospitals|hospital list|panel hospitals?|empanell?ed|can i go to [a-z ]+ for cashless|is [a-z ]+ (a )?(network|cashless)|hospitals? (are |is )?(cashless|in (the )?network))\b/],
  ['copay', /\bco-?pay(ment)?\b/],
  ['room', /\b(room rent|room upgrade|upgrade (my |the |a )?room|bigger room|private room|room limit|room category|suite)\b/],
  ['renewal', /\b(renew\w*|grace period|lapse\w*|missed .{0,15}premium|premium (is )?(due|unpaid|overdue))\b/],
  ['documents', /\b(what documents|which documents|documents (are |do i )?(needed|required|need)|paperwork|documents for)\b/],
  ['cashless_how', /\b(how (do|does|can|to) .{0,20}cashless|cashless (process|steps|work\w*|claim))\b/],
  ['reimbursement_how', /\b(how (do|can|to) (i |we )?(file|make|claim|get|raise) .{0,20}(reimburs\w*|claim)|reimbursement (process|claim|steps)|claim process|how to claim)\b/],
];

// Common misspellings and Hinglish words mapped to the terms the rules use
const NORMALISE: [RegExp, string][] = [
  [/\binsu?ra?n[cs]e?\b|\binsurence\b|\binsurnace\b|\binsurace\b/g, 'insurance'],
  [/\bpolicey\b|\bpolicy?s\b/g, 'policy'],
  [/\bcoverd\b|\bcovred\b|\bcoverred\b|\bcovrd\b/g, 'covered'],
  [/\bcl(ai|ia|a)me?\b/g, 'claim'],
  [/\bhospit(a)?l\b|\bhospitel\b|\bhosptial\b|\bhospial\b/g, 'hospital'],
  [/\bmater(i)?nity\b|\bmaternaty\b|\bmaternty\b/g, 'maternity'],
  [/\bdiabet(is|ies|es)\b|\bdiabities\b|\bdibetes\b/g, 'diabetes'],
  [/\bsu(r)?ga?ry\b|\bsurgary\b|\bsurgerry\b/g, 'surgery'],
  [/\bcatarac\b|\bcatract\b/g, 'cataract'],
  [/\bpre[- ]?exi?sting\b/g, 'pre-existing'],
  [/\bkya\b|\bhai\b|\bhain\b|\bmera\b|\bmeri\b|\bmere\b|\bka\b|\bki\b|\bke\b/g, ' '],
  [/\bbimar\b|\bbeemar\b/g, 'ill'],
  [/\bpaisa\b|\bpaise\b/g, 'money'],
];

function normalise(message: string): string {
  let t = message.toLowerCase().replace(/[’`]/g, "'");
  for (const [re, to] of NORMALISE) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function expand(text: string): string {
  const t = text.toLowerCase();
  return EXPANSIONS.reduce((out, [re, add]) => (re.test(t) ? `${out} ${add}` : out), text);
}

export const SUGGESTED_PROMPTS = [
  'My father is admitted in hospital for a heart problem',
  'I have diabetes, if I get treated and pay cash will I be reimbursed?',
  'Is maternity covered for my spouse?',
  'What happens to my family if I die?',
];

function detectCategories(t: string): ActiveCategory[] {
  return CATEGORY_CUES.filter(([, re]) => re.test(t)).map(([c]) => c);
}

const TOPIC_PHRASES = [...new Set(portfolio.policies.flatMap((p) => p.clauses.flatMap((c) => c.topics.filter((x) => x.includes(' ')))))].sort((a, b) => b.length - a.length);
const clauseTopics = (clauseId: string) => portfolio.policies.flatMap((p) => p.clauses).find((c) => c.id === clauseId)?.topics ?? [];
const GENERIC_NAME_WORDS = new Set(['health', 'shield', 'plus', 'term', 'life', 'policy', 'plan', 'family', 'cover', 'insurance']);

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

function topicWords(message: string): string[] {
  return message.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length > 3).slice(0, 12);
}

// ---------- simple answers ----------

function clarify(col: Collector, headline: string, suggestions: string[] = SUGGESTED_PROMPTS, keyPoints?: string[]): AgentAnswer {
  return col.answer('', { headline, keyPoints, suggestions });
}

function policiesFor(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): string[] | null {
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
  else return clarify(col, 'Which policies should I compare — your two health policies?', ['Compare my health policies', 'Compare my term life policies']);
  col.call('searchPolicies', { query: message, category: cats.length === 1 ? cats[0] : undefined });
  if (ids.length < 2) {
    const p = portfolio.policies.find((x) => x.id === ids[0])!;
    return col.answer('', {
      headline: `You have one ${CATEGORY_LABEL[p.category as ActiveCategory]} policy, so there’s nothing to compare it with.`,
      verdict: 'info',
      suggestions: [`Explain my ${p.name} policy`, 'Compare my health policies'],
    });
  }
  const cmp = col.call('comparePolicies', { policyIds: ids, criteria: [] });
  if (!cmp.rows) return col.answer('', { headline: 'I couldn’t build that comparison from your policy data.', verdict: 'info' });
  const policies = ids.map((id) => portfolio.policies.find((p) => p.id === id)!);
  const health = policies.every((p) => p.category === 'health') && policies.length === 2;
  if (!health) {
    return col.answer('', { headline: `Here’s how your ${cats.length === 1 ? `${CATEGORY_LABEL[cats[0]]} ` : ''}policies compare.`, verdict: 'info', keyPoints: ['Each row shows the matching clause from each policy.', '“Not specified” means the policy data doesn’t say. It isn’t a confirmed gap.'] });
  }
  const g = policies.find((p) => clauseWith(p, 'condition', ['employment']))!;
  const f = policies.find((p) => p !== g)!;
  const fPed = clauseWith(f, 'waiting_period', ['pre-existing']);
  const fMat = clauseWith(f, 'waiting_period', ['maternity']);
  const gCard = clauseWith(g, 'limit', ['cardiac']);
  const copay = g.clauses.find((c) => c.type === 'deductible' && c.percent);
  const matEnds = fMat?.text.match(/(\d+) months, counted from (\d{4}-\d{2}-\d{2})/);
  const matEnd = matEnds ? (() => { const d = new Date(matEnds[2] + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + Number(matEnds[1])); return d.toISOString().slice(0, 10); })() : undefined;
  const father = g.insured.find((i) => /\(father\)/.test(i)) && !f.insured.some((i) => /\(father\)/.test(i));
  return col.answer('', {
    headline: `Use ${g.name} first for ${father ? 'your father, ' : ''}maternity and pre-existing conditions — ${f.name} has ${f.sumInsured >= 2 * g.sumInsured ? 'twice the cover' : 'more cover'} and stays if you change jobs.`,
    verdict: 'info',
    keyPoints: [
      `Sum insured: ${inr(f.sumInsured)} on ${f.name}, ${inr(g.sumInsured)} on ${g.name}.`,
      `${g.name}: day-one pre-existing and maternity cover${copay ? `, ${copay.percent}% co-pay for parents` : ''}${gCard?.amount ? `, cardiac procedures capped at ${inr(gCard.amount)}` : ''}.`,
      `${f.name}: no co-pay or cardiac cap${fPed ? ', pre-existing wait already served' : ''}${matEnd ? `, maternity only from ${fmtDate(matEnd)}` : ''}.`,
    ],
    details: [{ id: 'compare-notes', title: 'How to read this comparison', body: '- Each row shows the matching clause from each policy.\n- “Not specified” means the policy data doesn’t say. It isn’t a confirmed gap.\n- No single policy is “best”. It depends on who needs cover and for what.' }],
    suggestions: ['Is maternity covered for my spouse?', 'If I leave my job, do I lose the group health cover?', 'My father is admitted in hospital for a heart problem'],
  });
}

function runExplain(col: Collector, message: string, t: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  const ids = policiesFor(col, message, cats, named);
  if (!ids?.length) return clarify(col, 'Which policy should I explain — health or term life?', ['Explain my Family Floater Shield policy', 'Explain my Secure Term Plus policy']);
  const targets = ids.slice(0, 2);
  const many = targets.length > 1;
  const policies = targets.map((id) => portfolio.policies.find((p) => p.id === id)!);
  const source = '- From your policy schedule and clauses. Your insurer’s documents are the final word.';
  const sug = policies.some((p) => p.category === 'life') ? ['What happens to my family if I die?', 'Can I change the nominee on my term policy?'] : ['Compare my health policies', 'Which hospitals in Pune are cashless?'];

  if (WHO_COVERED.test(t)) {
    for (const id of targets) col.call('retrievePolicyEvidence', { policyId: id, topics: [] });
    if (!many) return col.answer('', { headline: `${policies[0].name} covers ${policies[0].insured.join(', ')}.`, verdict: 'info', suggestions: sug });
    return col.answer('', { headline: 'Who each policy covers:', verdict: 'info', keyPoints: policies.map((p) => `${p.name}: ${p.insured.join(', ')}.`), suggestions: ['Is my mother covered?', ...sug].slice(0, 3) });
  }
  if (PERIOD_Q.test(t)) {
    const lines: string[] = [];
    for (const p of policies) {
      const r = col.call('retrievePolicyEvidence', { policyId: p.id, topics: [] });
      const till = (r.policy?.keyFacts ?? []).filter((f: { label: string }) => /till|expires|until/i.test(f.label));
      lines.push(`${p.name}: current period ${fmtDate(p.startDate)} – ${fmtDate(p.renewalDate)}${till.map((f: { label: string; value: string }) => `; ${f.label.toLowerCase()} ${f.value}`).join('')}.`);
    }
    const p0 = policies[0];
    const tillFact = p0.keyFacts.find((f) => /till/i.test(f.label));
    const headline = many ? 'Policy periods:' : p0.category === 'life' && tillFact ? `${p0.name} covers you till ${tillFact.value.toLowerCase()}; the next premium is due ${fmtDate(p0.renewalDate)}.` : `${p0.name} renews on ${fmtDate(p0.renewalDate)}.`;
    return col.answer('', { headline, verdict: 'info', keyPoints: lines, suggestions: sug });
  }
  const typeAsk = TYPE_ASK.filter(([, re]) => re.test(t));
  if (typeAsk.length === 1 && !EXPLAIN.test(t)) {
    const [type, , label] = typeAsk[0];
    const lines: string[] = [];
    for (const p of policies) {
      const r = col.call('retrievePolicyEvidence', { policyId: p.id, topics: [] });
      const items: EvidenceItem[] = p.clauses.filter((c) => c.type === type).map((c) => r.evidence?.find((e: EvidenceItem) => e.clauseId === c.id) ?? { title: c.title, section: c.section, text: c.text } as EvidenceItem);
      if (!items.length) lines.push(`- **${p.name}:** none listed in the policy.`);
      for (const e of items) lines.push(`- ${many ? `**${p.name}** — ` : ''}**${e.title}** (${e.section}): ${e.text}`);
    }
    return col.structured(`**${label} in ${policies.map((p) => p.name).join(' and ')}.**\n\n${lines.join('\n')}`, { moreTitle: `All ${label.toLowerCase()}`, suggestions: sug });
  }

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
    const head = found.length === 1 ? `**${found[0].title}: ${found[0].text}**` : `**What your policies say about ${phrase}.**`;
    return col.structured(`${head}\n\n${found.length === 1 ? '' : lines.join('\n')}`, { suggestions: sug });
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
    const policy = portfolio.policies.find((p) => p.id === id)!;
    const facts: { label: string; value: string }[] = general ? [] : matchedFacts(policy, t);
    if (facts.length) {
      if (!head) head = many ? `**Here’s what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**` : `**${policy.name} — ${facts[0].label.toLowerCase()}: ${facts[0].value}.**`;
      for (const f of facts.slice(many ? 0 : 1)) lines.push(`- ${many ? `${pol.name} — ` : ''}${f.label}: ${f.value}`);
      if (!many && ev[0]) lines.push(`- ${ev[0].title} (${ev[0].section}): ${ev[0].text}`);
    } else if (!general && ev.length) {
      if (!head) head = many ? `**Here’s what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**` : `**${ev[0].title}: ${ev[0].text}**`;
      if (many) lines.push(`- ${pol.name}: ${ev[0].text}`);
      if (!many && ev[1] && ev[0].type === 'benefit' && ev[1].type === 'benefit') lines.push(`- Also: ${ev[1].title} (${ev[1].section}): ${ev[1].text}`);
    } else if (!general) {
      lines.push(`- ${pol.name}: not mentioned in the policy.`);
    } else {
      const pick = (types: string[]) => policy.clauses.find((e) => types.includes(e.type));
      if (!head) head = targets.length === 1 ? `**${pol.name} covers ${pol.insured.join(', ')} for ${pol.sumInsured}.**` : `**Here’s what your ${CATEGORY_LABEL[pol.category as ActiveCategory]} policies say.**`;
      const prefix = targets.length > 1 ? `${pol.name}: ` : '';
      if (targets.length > 1) lines.push(`- ${prefix}Covers ${pol.insured.join(', ')} · ${pol.sumInsured}.`);
      const benefit = pick(['benefit']);
      const exclusion = pick(['exclusion']);
      const watch = pick(['waiting_period', 'deductible', 'limit', 'condition']);
      if (benefit) lines.push(`- ${prefix}Main benefit: ${benefit.title} (${benefit.section}).`);
      if (exclusion) lines.push(`- ${prefix}Key exclusion: ${exclusion.title} (${exclusion.section}).`);
      if (watch && targets.length === 1) lines.push(`- Watch for: ${watch.title} (${watch.section}).`);
      if (targets.length === 1) for (const k of policy.keyFacts.slice(0, 1)) lines.push(`- ${k.label}: ${k.value}.`);
    }
  }
  if (!head) return clarify(col, 'I couldn’t find that in your policies. That means the policy data doesn’t say, not that it’s excluded.');
  lines.push(source);
  return col.structured(`${head}\n\n${lines.join('\n')}`, { suggestions: sug });
}

function runPrepare(col: Collector, message: string, cats: ActiveCategory[], named: Policy[]): AgentAnswer {
  const ids = policiesFor(col, message, cats, named);
  if (!ids?.length) return clarify(col, 'Which policy are you preparing to use — health or term life?');
  const lines: string[] = [];
  for (const id of ids.slice(0, 2)) {
    const r = col.call('retrievePolicyEvidence', { policyId: id, topics: [] });
    if (r.policy) for (const f of (r.policy.keyFacts ?? []).slice(0, 3)) lines.push(`- ${f.label}: ${f.value}`);
  }
  col.call('generateActionPlan', { scenario: message, policyIds: ids.slice(0, 2), urgent: false });
  const names = ids.slice(0, 2).map((id) => portfolio.policies.find((p) => p.id === id)!.name).join(' and ');
  return col.structured(`**Here’s what to check in ${names}.**\n\n${lines.slice(0, 4).join('\n')}`);
}

// ---------- input checks (run before any tool) ----------

function guard(message: string, insuranceRelated: boolean): AgentAnswer | null {
  const blocked = (headline: string, detail: string): AgentAnswer => ({
    headline,
    text: '',
    steps: [{ tool: 'guardrail', label: 'Safety check', detail, ok: true }],
    coverage: [],
    evidence: [],
    suggestions: SUGGESTED_PROMPTS.slice(0, 3),
  });
  const letters = message.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return blocked('I didn’t catch that — try one of these:', 'Unclear input');
  if (/(.)\1{9,}/.test(message) || (letters.length > 20 && !/[aeiou]/i.test(letters)) || (letters.length >= 4 && !/\s/.test(message.trim()) && !/[aeiou]{1}/i.test(letters))) return blocked('That doesn’t look like a question — describe what happened in a sentence, or try:', 'Unreadable input');
  if (JAILBREAK.test(message)) return blocked(`I can’t change how I work — I only answer from your ${portfolio.policies.length} health and term life policies.`, 'Manipulation attempt blocked');
  if (ABUSE.test(message) && !insuranceRelated) return blocked('I’m here to help with your insurance — tell me what happened, or try:', 'Abusive input');
  return null;
}

// ---------- entry ----------

const route = (col: Collector, detail: string) => col.note({ tool: 'resolveIntent', label: 'Matching your question to a supported topic', detail, ok: true });

function lifeTopic(t: string): LifeTopic | 'explain' {
  const c = readLifeContext(t);
  if (REJECTED.test(t) && /\bclaim\b/.test(t)) return 'rejected';
  if (c.suicide) return 'suicide';
  if (NOMINEE_CHANGE.test(t)) return 'nominee_change';
  if (LIFE_NO_HEALTH.test(t) && !/\b(die|death|died|pass(ed)? away)\b/.test(t)) return 'no_health';
  if (/\b(have|has|is there|any|got)\b.{0,30}\brider\b/.test(t) && !c.intoxication) return 'rider';
  if (c.disclosureTopic) return 'disclosure';
  if (c.missedPremium) return 'premium';
  if (PREMIUM_DUE.test(t)) return 'premium_due';
  if (LIFE_CLAIM.test(t)) return 'claim';
  if (PERIOD_Q.test(t)) return 'explain';
  if (c.abroad && /\b(die|death|died|dies|pass(ed)? away|killed)\b/.test(t)) return 'abroad';
  if (RIDER_Q.test(t) && !/\b(die|death|died|dies|pass(ed)? away|receive|get|pay)\b/.test(t)) return 'rider';
  if (c.accident) return 'accident';
  if (DEATH_Q.test(t)) return 'payout';
  return 'explain';
}

export async function runAgent(message: string, emit: (s: AgentStep) => void): Promise<AgentAnswer> {
  const t = normalise(message);
  const subject = SUBJECT.filter(([, re]) => re.test(t)).map(([c]) => c);
  let cats = subject.length ? subject : detectCategories(t);
  const named = namedPolicies(t);
  for (const p of named) if (!cats.includes(p.category as ActiveCategory)) cats = [...cats, p.category as ActiveCategory];
  const outOfScope = OUT_OF_SCOPE.test(t);
  const s = readSituation(t);
  // Something medical is happening, or a treatment is named: that's a health question even without insurance words
  if (!cats.includes('health') && (s.topic || s.payCash || ['admitted', 'emergency_now', 'incident', 'discharged'].includes(s.care))) cats = [...cats, 'health'];
  const insuranceRelated = cats.length > 0 || named.length > 0 || outOfScope || INSURANCE_WORDS.test(t) || VAGUE.test(t);

  const blocked = guard(message, insuranceRelated);
  if (blocked) { emit(blocked.steps[0]); return blocked; }

  const col = new Collector(emit);
  if (FOLLOW_UP.test(t) && cats.length === 0 && named.length === 0) {
    route(col, 'Follow-up without context');
    return clarify(col, 'Could you ask the full question? I answer each message on its own.', ['Is maternity covered for my spouse?', 'Is my father covered?', 'Is my mother covered?']);
  }
  if (GREETING.test(t)) {
    route(col, 'Greeting');
    return /thank|thx|ok|cool|great/.test(t)
      ? col.answer('', { headline: 'You’re welcome — ask me anything about your health or term life policies.', suggestions: SUGGESTED_PROMPTS.slice(0, 3) })
      : col.answer('', { headline: `Hi ${portfolio.user.name.split(' ')[0]} — ask me anything about your health or term life policies, and I’ll show the clause behind each answer.`, suggestions: SUGGESTED_PROMPTS.slice(0, 3) });
  }
  if (!insuranceRelated) {
    route(col, 'Not an insurance question');
    return clarify(col, 'I can only help with your health and term life policies.');
  }
  if (outOfScope && !cats.length && !named.length) {
    route(col, 'Outside health and term life');
    return clarify(col, 'I can help with health and term life insurance only, not car, travel, home or personal accident.', ['Compare my health policies', 'What happens to my family if I die?']);
  }
  if (UNSUPPORTED.test(t)) {
    route(col, 'Not supported');
    return clarify(col, 'I can’t buy, change or file anything with an insurer — I explain the policies you already have.', ['Compare my health policies', 'Can I port my family floater to another insurer?', 'What happens to my family if I die?']);
  }
  if (outOfScope) col.scopeNote = 'I can only answer the health and term life part of this. Car, travel, home and personal accident cover aren’t included.';

  const healthy = cats.includes('health');

  if (COMPARE.test(t)) { route(col, 'Compare policies'); return runCompare(col, message, cats.length ? cats : ['health'], named); }
  if (GUARANTEE_ONLY.test(t) && !s.topic && s.care === 'none' && !s.persons.some((p) => p !== 'self')) { route(col, 'Guarantee request'); return runHealthTopic(col, t, 'guarantee', s); }

  // Term life
  const lifeAsked = cats.includes('life') && (!cats.includes('health') || subject.includes('life') || /\b(term|life (policy|insurance|cover)|nominee|suicide|section 45|critical illness)\b/.test(t) || (/\b(die|death|died|pass(ed)? away)\b/.test(t) && s.care === 'none'));
  if (lifeAsked) {
    const k = lifeTopic(t);
    if (k !== 'explain') { route(col, `Term life: ${k.replace('_', ' ')}`); return runLife(col, t, k); }
    route(col, 'Explain policy details');
    return runExplain(col, message, t, ['life'], named.filter((p) => p.category === 'life'));
  }

  // Vague questions: ask one clarifying question with options
  if (VAGUE.test(t) && !s.topic && s.care === 'none' && !named.length) {
    route(col, 'Needs one detail');
    return clarify(col, 'Covered for what, and for whom? Pick one or describe it:', ['Is a hospital stay covered for my father?', 'Is maternity covered for my spouse?', 'Is cataract surgery covered for me?']);
  }

  // Health topics answered from one or two clauses
  const topicHit = HEALTH_TOPICS.find(([k, re]) => re.test(t) && topicApplies(k, s, t));
  if (topicHit) { route(col, `Health: ${topicHit[0].replace('_', ' ')}`); return runHealthTopic(col, t, topicHit[0], s, named.filter((p) => p.category === 'health').map((p) => p.id)); }

  // Policy details ("What's the sum insured on…?", "Tell me about…")
  const targets = named.length ? named : portfolio.policies.filter((p) => (cats as Category[]).includes(p.category));
  const asksDetail = EXPLAIN.test(t) || WHO_COVERED.test(t) || PERIOD_Q.test(t) || TYPE_ASK.some(([, re]) => re.test(t) && !s.topic)
    || (DETAIL_QUESTION.test(t) && !s.topic && s.care === 'none' && !s.persons.some((p) => p !== 'self') && targets.some((p) => matchedFacts(p, t).length));
  if (asksDetail) { route(col, 'Explain policy details'); return runExplain(col, message, t, cats, named); }
  if (PREPARE.test(t)) { route(col, 'Prepare / what to check'); return runPrepare(col, message, cats, named); }

  // A health situation or coverage question
  if (healthy || s.persons.length) {
    route(col, s.care === 'emergency_now' ? 'Medical emergency' : s.care === 'admitted' || s.care === 'incident' ? 'In hospital' : s.care === 'planned' ? 'Planned treatment' : s.care === 'discharged' || s.payCash ? 'Reimbursement' : 'Coverage check');
    return runHealth(col, t, s, named.filter((p) => p.category === 'health').map((p) => p.id));
  }
  route(col, 'Needs one detail');
  return clarify(col, 'Is this about your health policies or your term life policy?', ['Compare my health policies', 'What happens to my family if I die?', 'Is maternity covered for my spouse?']);
}

/** A clause-level topic only applies when the message isn't really describing a treatment situation. */
function topicApplies(k: HealthTopic, s: Situation, t: string): boolean {
  const situation = s.care !== 'none' || !!s.topic || s.payCash;
  switch (k) {
    case 'job': case 'portability': case 'sum_left': case 'rejected': return true;
    case 'add_member': return !situation || /\b(newborn|new born)\b/.test(t);
    case 'disclosure': return !s.topic;
    case 'network': return !s.topic && (s.care === 'none' || s.care === 'planned') && !s.payCash;
    case 'copay': return !s.bill && s.care === 'none' && !s.topic;
    case 'room': return !s.bill && s.care === 'none';
    case 'renewal': return !situation;
    case 'documents': return !s.persons.some((p) => p !== 'self') || s.care === 'none';
    case 'cashless_how': return s.care === 'none' && !s.topic;
    case 'reimbursement_how': return !situation && !s.persons.some((p) => p !== 'self');
    case 'guarantee': return false;
  }
}

type Situation = ReturnType<typeof readSituation>;
