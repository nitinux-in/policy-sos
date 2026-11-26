// Scenario composers: turn the claim-factor checks into a direct, scannable answer.
//
// Every answer leads with a one-sentence headline that answers the question asked, then at most four key
// points (deadlines, numbers, who to call), a confidence rating built from the factors (server/confidence.ts),
// and longer explanations folded into details sections. Every coverage statement comes from a clause.
// See docs/answer-scenarios.md for the scenario matrix.

import type { AgentAnswer, AnswerSection, ConfidenceFactor, CostResult, Policy, Verdict } from '../shared/types.js';
import { DEMO_TODAY } from '../shared/demo.js';
import { portfolio } from './tools.js';
import { Collector, SAFETY_NOW } from './collector.js';
import { cap, clauseWith, fmtDate, inr, networkList, orderFactors, rate, sumInsuredUsed, waitInfo, type LifeAssessment, type PolicyAssessment } from './confidence.js';
import { readLifeContext, type Gender, type Person, type PersonName, type Situation } from './situation.js';

const HEALTH = portfolio.policies.filter((p) => p.category === 'health');
const LIFE = portfolio.policies.filter((p) => p.category === 'life');
const byId = (id: string) => portfolio.policies.find((p) => p.id === id)!;
/** The personal floater and the employer plan (the employer plan is the one tied to employment). */
const EMPLOYER = HEALTH.find((p) => !!clauseWith(p, 'condition', ['employment']));
const FLOATER = HEALTH.find((p) => p !== EMPLOYER);

const GUARANTEE = /(guarantee|promise|100%|definitely|confirm|assure).{0,40}(approv|pay|cover|claim|settle)/;

// ---------- people and wording ----------

const DEFAULT_NAMES: Record<Person, PersonName> = {
  self: { noun: 'you', g: 'n' }, spouse: { noun: 'your spouse', g: 'n' }, son: { noun: 'your son', g: 'm' }, daughter: { noun: 'your daughter', g: 'f' },
  father: { noun: 'your father', g: 'm' }, mother: { noun: 'your mother', g: 'f' }, sibling: { noun: 'your sibling', g: 'n' },
  grandparent: { noun: 'your grandparent', g: 'n' }, inlaw: { noun: 'your in-law', g: 'n' }, other: { noun: 'this person', g: 'n' },
};

/** Words for one person in one answer: "your wife" / "she" / "her" … */
class Who {
  constructor(readonly person: Person, private name: PersonName) {}
  static of(s: Situation, person: Person) { return new Who(person, s.names[person] ?? DEFAULT_NAMES[person]); }
  get self() { return this.person === 'self'; }
  get g(): Gender { return this.self ? 'n' : this.name.g; }
  get noun() { return this.self ? 'you' : this.name.noun; }
  get Noun() { return cap(this.noun); }
  get poss() { return this.self ? 'your' : `${this.noun}’s`; }
  get sub() { return this.self ? 'you' : ({ m: 'he', f: 'she', n: 'they', pl: 'they' } as const)[this.g]; }
  get obj() { return this.self ? 'you' : ({ m: 'him', f: 'her', n: 'them', pl: 'them' } as const)[this.g]; }
  get his() { return this.self ? 'your' : ({ m: 'his', f: 'her', n: 'their', pl: 'their' } as const)[this.g]; }
  /** verb for the noun as subject: "your father is" / "you are" / "your in-laws are" */
  get is() { return this.self || this.g === 'pl' ? 'are' : 'is'; }
  get isnt() { return this.self || this.g === 'pl' ? 'aren’t' : 'isn’t'; }
  /** verb for the pronoun as subject: "he has" / "they have" */
  get subHas() { return this.self || this.g === 'n' || this.g === 'pl' ? 'have' : 'has'; }
  get subIs() { return this.self || this.g === 'n' || this.g === 'pl' ? 'are' : 'is'; }
  /** "you’re" / "he’s" / "they’re" */
  get subBe() { return `${this.sub}${this.subIs === 'are' ? '’re' : '’s'}`; }
  /** "my father" — for follow-up prompts */
  get my() { return this.self ? 'me' : this.noun.replace(/^your /, 'my ').replace(/^(Meera|Kabir)$/, (m) => (m === 'Meera' ? 'Meera' : 'Kabir')); }
}

const tpaOf = (p: Policy) => (/TPA/.test(clauseWith(p, 'benefit', ['cashless'])?.text ?? '') ? 'TPA' : 'insurer');
/** Who to tell, with the TPA explained: "the insurer’s claims desk (TPA)" / "the insurer" */
const deskOf = (p: Policy) => (tpaOf(p) === 'TPA' ? 'the insurer’s claims desk (TPA)' : 'the insurer');
const contactOf = (p: Policy) => p.claimContact ?? p.provider;
const shortHosp = (h: string) => h.replace(/ (Multispeciality|General|Care Hospital|Hospital)$/, '');
const lc = (s: string) => (/^[A-Z][a-z]+ [A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const firstName = (insured: string) => insured.split(' ')[0];

/** "you, Meera (spouse), Kabir (son) and Suresh (father, Employer Group Health only)" */
function coveredPeople(): string {
  const people = new Map<string, { rel: string; on: string[] }>();
  for (const p of HEALTH) for (const i of p.insured) {
    const [name, rel] = [i.split(' (')[0], i.match(/\((\w+)\)/)?.[1] ?? ''];
    const e = people.get(name) ?? { rel, on: [] };
    e.on.push(p.name);
    people.set(name, e);
  }
  return listJoin([...people.entries()].map(([name, e]) => (/self|employee/.test(e.rel) ? 'you' : `${firstName(name)} (${e.rel}${e.on.length < HEALTH.length ? `, ${e.on[0]} only` : ''})`)));
}

function nextApril1(): string {
  const y = Number(DEMO_TODAY.slice(0, 4));
  return `${DEMO_TODAY.slice(5) < '04-01' ? y : y + 1}-04-01`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Retrieves the clauses the answer will cite (a real tool step per policy). */
function retrieve(col: Collector, ids: string[], topics: string[]) {
  for (const id of ids) col.call('retrievePolicyEvidence', { policyId: id, topics: topics.slice(0, 15) });
}

function topicTags(s: Situation): string[] {
  const t = s.topic;
  const tags = new Set<string>([...(t?.benefit ?? []), ...(t?.wait ?? []), ...(t?.sublimit ?? []), ...(t?.exclusion ?? [])]);
  if (!t || t.kind === 'treatment' || t.kind === 'chronic') tags.add('hospitalisation');
  if (s.care !== 'none' || s.wantsCashless) ['cashless', 'network'].forEach((x) => tags.add(x));
  if (s.preExisting || t?.kind === 'chronic' || t?.oftenPreExisting) ['pre-existing', 'disclosure'].forEach((x) => tags.add(x));
  if (s.payCash || s.care === 'discharged') ['reimbursement', 'documents'].forEach((x) => tags.add(x));
  return [...tags];
}

// ---------- details sections (only the relevant ones are attached) ----------

function cashlessSection(p: Policy, id = 'cashless', title = 'How cashless works'): AnswerSection {
  const cashless = clauseWith(p, 'benefit', ['cashless']);
  const deadlines = clauseWith(p, 'condition', ['intimation']);
  return {
    id,
    title,
    summary: `${p.name}: network hospitals only`,
    body: [
      `1. **Go to a network hospital:** ${listJoin(networkList(p))}.`,
      `2. **Show your health card** (policy no. ${p.policyNumber}) and photo ID at the hospital’s insurance (TPA) desk.`,
      `3. **The hospital asks the ${tpaOf(p)} for approval.** ${cashless?.text ?? ''}`,
      '4. **At discharge**, the insurer pays the approved amount to the hospital. You pay only for items the policy doesn’t cover, any co-pay and anything above the limits.',
      '',
      `If cashless is refused or only partly approved, treatment carries on. Pay the hospital and claim the rest as reimbursement.${deadlines ? ` (${p.name}, ${deadlines.section})` : ''}`,
    ].join('\n'),
  };
}

function reimbursementSection(p: Policy, id = 'reimbursement', title = 'How a reimbursement claim works'): AnswerSection {
  const proc = p.clauses.find((c) => c.type === 'claim_process');
  const deadlines = clauseWith(p, 'condition', ['intimation']);
  const prepost = clauseWith(p, 'benefit', ['pre hospitalisation']);
  return {
    id,
    title,
    summary: proc?.text.match(/within \d+ days of discharge/i)?.[0],
    body: [
      '**Documents to keep**',
      '- Claim form (from the insurer or HR portal) and the patient’s photo ID',
      '- Discharge summary',
      '- Final itemised bill and payment receipts',
      '- Doctor’s prescriptions and test reports',
      '- Cancelled cheque or bank details for the payout',
      '',
      `**${p.name}, ${proc?.section ?? 'claim process'}:** ${proc?.text ?? 'the policy data has no claim-process clause.'}`,
      deadlines ? `\n**Deadlines (${deadlines.section}):** ${deadlines.text}` : '',
      prepost ? `\n**Follow-up costs (${prepost.section}):** ${prepost.text}` : '',
    ].filter(Boolean).join('\n'),
  };
}

function disclosureSection(p: Policy): AnswerSection | undefined {
  const c = clauseWith(p, 'condition', ['disclosure']);
  if (!c || clauseWith(p, 'condition', ['underwriting'])) return undefined;
  return {
    id: 'non-disclosure',
    title: 'If a condition wasn’t declared',
    summary: 'Rejection, cancellation and the 60-month rule',
    body: [
      `**${p.name}, ${c.section}:** ${c.text}`,
      '',
      '**What happens if it’s found at claim time**',
      '- The insurer checks hospital records, past prescriptions and test reports.',
      '- If the condition existed before the policy and wasn’t declared, the related claim can be **rejected**, and the policy can be **cancelled**.',
      '- Group policies, like an employer plan, don’t ask health questions, so this risk doesn’t apply there.',
      '',
      '**What you can do now:** if something wasn’t declared, tell the insurer in writing before you need to claim. They may add a waiting period or raise the premium, which is far better than a rejected claim later.',
    ].join('\n'),
  };
}

function rejectedSection(policies: Policy[]): AnswerSection {
  const g = policies.map((p) => clauseWith(p, 'condition', ['grievance'])).find(Boolean);
  return {
    id: 'rejected',
    title: 'If the claim is rejected',
    summary: 'Grievance Officer, then Ombudsman',
    body: [
      '1. **Get the reason in writing.** The rejection letter must name the clause.',
      '2. **Reply with evidence:** a doctor’s certificate, earlier records showing when the condition started, or the missing document.',
      `3. **Escalate to the Grievance Officer.** ${g?.text ?? ''}`,
      '4. **Go to the Insurance Ombudsman.** It’s free, and you don’t need a lawyer.',
      '',
      'Rejections that often get reversed: a missing document, a late claim with a genuine reason, or a condition wrongly treated as pre-existing.',
    ].join('\n'),
  };
}

function twoPoliciesSection(w: Who, a: PolicyAssessment, b: PolicyAssessment): AnswerSection {
  return {
    id: 'two-policies',
    title: 'Using both policies together',
    summary: `${inr(a.siLeft + b.siLeft)} combined`,
    body: [
      `${w.self ? 'You are' : `${w.Noun} ${w.is}`} insured under both **${a.policyName}** (${inr(a.siLeft)} available) and **${b.policyName}** (${inr(b.siLeft)} available).`,
      '',
      '- Claim from one policy first. If the bill is more than it pays, claim the balance from the other.',
      '- For the second claim, submit the first insurer’s settlement letter with attested copies of the bills.',
      '- You choose which policy to use first. Using the employer policy first keeps your own floater’s sum insured free for the rest of the family.',
    ].join('\n'),
  };
}

function waitingSection(a: PolicyAssessment): AnswerSection | undefined {
  const c = a.mainClause;
  if (!c || c.type !== 'waiting_period') return undefined;
  const w = waitInfo(byId(a.policyId), c);
  return {
    id: `waiting-period-${a.policyId.toLowerCase()}`,
    title: `${a.policyName}: how the waiting period works`,
    summary: w ? `Ends ${fmtDate(w.ends)}` : undefined,
    body: [
      `**${c.section}:** ${c.text}`,
      '',
      w ? `It runs ${w.length} ${w.unit} from ${fmtDate(w.from)}, so it ends on **${fmtDate(w.ends)}**. This policy doesn’t pay for treatment before then.` : '',
      'Waiting periods continue across renewals and carry over when you port, as long as there is no break in cover.',
    ].filter(Boolean).join('\n'),
  };
}

function addMemberSection(): AnswerSection {
  const lines = HEALTH.flatMap((p) => { const c = clauseWith(p, 'condition', ['add member']); return c ? [`- **${p.name} (${c.section}):** ${c.text}`] : []; });
  return { id: 'add-member', title: 'Adding a family member', body: lines.join('\n') };
}

// ---------- health ----------

function scoreOf(a: PolicyAssessment): number {
  // A disclosure question weighs more than a sub-limit: it can decide whether the claim is paid at all
  return a.factors.reduce((s, x) => s + (x.status === 'risk' ? (x.impact === 'reduces' ? 3 : 100) : x.status === 'unknown' ? 10 : x.status === 'check' ? (x.id === 'disclosure' ? 5 : 1) : 0), 0) + (a.certainDeduction ? 5 : 0);
}
function pickPrimary(list: PolicyAssessment[], prefer: string[] = []): PolicyAssessment | undefined {
  const covered = list.filter((a) => a.outcome === 'covered');
  return covered.find((a) => prefer.includes(a.policyId)) ?? covered.map((a, i) => ({ a, i, s: scoreOf(a) })).sort((x, y) => x.s - y.s || x.i - y.i)[0]?.a;
}

function cost(col: Collector, a: PolicyAssessment, message: string, s: Situation): CostResult | undefined {
  if (!s.wantsCost && !s.bill) return undefined;
  const c = col.call('calculatePotentialCost', { policyId: a.policyId, scenario: message, estimatedBill: s.bill, personAffected: a.person === 'self' ? undefined : a.person });
  return c && 'sufficientData' in c ? c : undefined;
}

/** How the bill gets paid, as a clause that follows ", and" in a headline ("Riverside’s TPA desk can arrange cashless"). Empty when the key points cover it. */
function routePhrase(a: PolicyAssessment, s: Situation): string {
  if (s.care === 'discharged' || (s.payCash && s.care === 'none')) return `you can claim reimbursement within ${a.docsDays ?? 30} days of discharge`;
  if (s.hospital) {
    const hit = a.network.find((h) => h.toLowerCase().includes(s.hospital!));
    return hit ? `${shortHosp(hit)}’s TPA desk can arrange cashless` : `since ${cap(s.hospital)} isn’t in its network, you pay first and claim reimbursement`;
  }
  if (s.nonNetworkHospital) return 'at a non-network hospital you pay first and claim reimbursement';
  return '';
}
const withRoute = (phrase: string) => (phrase ? `, and ${phrase}` : '');

/** What the person pays on top: "the 20% co-pay", "anything above the ₹3,00,000 cardiac procedures limit", … leaving out what the headline already says. */
function deductions(a: PolicyAssessment, skip: { copay?: boolean; sublimit?: boolean }): string[] {
  const parts: string[] = [];
  if (a.copayPercent && !skip.copay) parts.push(`the ${a.copayPercent}% co-pay`);
  if (a.sublimit?.amount && !skip.sublimit) {
    const per = a.sublimit.type === 'benefit' ? ' per delivery' : /eye/.test(a.sublimit.text) ? ' per eye' : '';
    parts.push(per ? `anything above ${inr(a.sublimit.amount)}${per}` : `anything above the ${inr(a.sublimit.amount)} ${a.sublimit.title.toLowerCase().replace(/ sub-limit$/, ' limit')}`);
  }
  if (a.factors.some((x) => x.id === 'non-medical')) parts.push('non-medical items');
  const room = a.factors.find((x) => x.id === 'room-rent');
  if (room) {
    const perDay = room.summary.match(/₹[\d,]+ a day/)?.[0];
    parts.push(perDay ? `more if the room costs over ${perDay}` : 'more if you choose a room above single private');
  }
  return parts;
}

/** Why the estimated share is what it is (the headline already gives the amounts). */
function costPoint(c: CostResult, a: PolicyAssessment): string {
  const why = c.lines.map((l) => l.label.replace(/ \((Section|Clause) [\d.]+\)/, '')
    .replace(/^Co-payment for parents (\d+)%$/, 'the $1% co-pay')
    .replace(/^Above (.+)$/, (_m, x: string) => `the amount above the ${x.toLowerCase().replace(/ sub-limit$/, ' limit')}`));
  const extra = a.factors.some((x) => x.id === 'non-medical') ? `Non-medical items or a costlier room would add to ${why.length ? 'it' : 'your share'}.` : '';
  return [why.length ? `That’s ${listJoin(why)}.` : '', extra].filter(Boolean).join(' ');
}

function otherPolicyPoint(w: Who, explicit: boolean, primary: PolicyAssessment, other: PolicyAssessment | undefined, cond: string, benefitOnly = false): { point?: string; factors: ConfidenceFactor[] } {
  if (!other || other.outcome === 'not_insured') return { factors: [] };
  if (other.outcome === 'covered') {
    const factors: ConfidenceFactor[] = [{ id: 'other-policy', label: 'Second policy', status: 'clear', summary: `${other.policyName} also covers this, ${other.sublimit?.amount ? `up to ${inr(other.sublimit.amount)}` : `with ${inr(other.siLeft)} more available`}`, clauseIds: other.mainClause ? [other.mainClause.id] : [] }];
    const disc = other.factors.find((x) => x.id === 'disclosure' && x.status !== 'clear');
    if (disc) factors.push({ ...disc, id: 'other-disclosure', label: `${other.policyName} · Disclosure` });
    const who = explicit ? w.obj : 'it';
    const upto = other.sublimit?.amount ? `, up to ${inr(other.sublimit.amount)}` : '';
    return {
      point: disc
        ? `Claiming from ${other.policyName} instead? ${cap(cond)} must have been declared when you bought it, or the claim can be rejected.`
        : benefitOnly ? `${other.policyName} also covers it.`
        : primary.sublimit?.amount
          ? `${other.policyName} also covers ${who}${upto}, so you can claim what’s above the ${primary.policyName} limit there.`
          : `${other.policyName} also covers ${who}${upto}. If the bill goes over ${inr(primary.siLeft)}, claim the rest there.`,
      factors,
    };
  }
  const why = other.factors.find((x) => (x.status === 'risk' && x.impact !== 'reduces') || x.status === 'unknown');
  if (!why) return { factors: [] };
  return { point: why.summary.startsWith(other.policyName) ? `${why.summary}.` : `${other.policyName}: ${lc(why.summary)}.`, factors: [] };
}

function healthSuggestions(s: Situation, w: Who, a: PolicyAssessment | undefined, extra: string[] = []): string[] {
  const out: string[] = [...extra];
  const mine = w.self ? 'my' : `${w.my}’s`;
  if (a?.outcome === 'covered' && !s.wantsCost && !s.bill && s.topic?.kind !== 'benefit') out.push(`How much will I pay if ${mine} hospital bill is ₹3 lakh?`);
  if (a?.factors.some((x) => x.id === 'disclosure' && x.status !== 'clear')) out.push('What if a condition wasn’t declared when I bought the policy?');
  if (s.care !== 'none' || s.payCash) out.push('What documents do I need for a health claim?');
  if (a?.outcome === 'covered' && s.care !== 'discharged' && !s.payCash && !s.hospital) out.push(`Which hospitals are cashless for ${w.my}?`);
  if (!a || a.outcome !== 'covered') out.push('My health claim was rejected. What can I do?');
  return [...new Set(out)].slice(0, 3);
}

export function runHealth(col: Collector, message: string, s: Situation, named: string[] = []): AgentAnswer {
  const persons: Person[] = s.persons.length ? s.persons.slice(0, 3) : [s.topic?.kind === 'maternity' ? 'spouse' : 'self'];
  const ids = HEALTH.map((p) => p.id);
  col.call('searchPolicies', { query: message, category: 'health' });
  retrieve(col, ids, topicTags(s));
  const r = col.call('assessClaimFactors', { policyIds: ids, scenario: message, persons });
  const all: PolicyAssessment[] = r.health ?? [];
  const groups = persons.map((person) => ({ w: Who.of(s, person), list: all.filter((a) => a.person === person) }));
  const safetyNotice = s.care === 'emergency_now' ? SAFETY_NOW : undefined;
  const guarantee = GUARANTEE.test(s.raw);
  if (groups.length > 1) return multiPerson(col, s, groups, safetyNotice);
  return singlePerson(col, message, s, groups[0].w, groups[0].list, safetyNotice, guarantee, named);
}

function singlePerson(col: Collector, message: string, s: Situation, w: Who, list: PolicyAssessment[], safetyNotice: string | undefined, guarantee: boolean, named: string[]): AgentAnswer {
  const label = s.topic && s.topic.id !== 'accident' ? s.topic.label : undefined;
  if (list.every((a) => a.outcome === 'not_insured')) return notInsured(col, s, w, list, safetyNotice);

  const primary = pickPrimary(list, named);
  if (!primary) return notCovered(col, s, w, list, guarantee, safetyNotice);

  const p = byId(primary.policyId);
  const other = list.find((a) => a !== primary);
  const c = cost(col, primary, message, s);
  const inCare = s.care === 'admitted' || s.care === 'incident' || s.care === 'emergency_now';
  const chronic = s.topic?.kind === 'chronic';
  const what = label ?? (s.accident ? 'accident treatment' : 'hospital treatment');
  const forWho = s.persons.length ? ` for ${w.noun}` : '';
  const cond = s.topic?.cond ?? label ?? 'the condition';
  const o = otherPolicyPoint(w, s.persons.length > 0, primary, other, cond, s.topic?.kind === 'benefit');
  const open = [...primary.factors, ...o.factors].some((x) => x.status === 'check' || x.status === 'unknown');
  const oop = c?.sufficientData ? c.estimatedOutOfPocket ?? 0 : undefined;
  let verdict: Verdict = primary.certainDeduction || (oop ?? 0) > 0 ? 'partial' : open ? 'likely' : 'yes';
  const inHeadline = { copay: false, sublimit: false };

  // ---- headline: the direct answer to the question asked ----
  let headline: string;
  if (s.care === 'emergency_now') {
    headline = `${p.name} covers ${w.poss} emergency admission at any hospital — you don’t need to do anything before treatment.`;
  } else if (s.care === 'admitted' && primary.exception === 'accident') {
    headline = `Yes — because the accident needed a hospital stay, ${p.name} covers ${w.poss} ${label ?? 'treatment'}${withRoute(routePhrase(primary, s))}.`;
  } else if (primary.exception === 'accident') {
    headline = `Only after an accident — ${p.name} pays for ${label ?? 'this'} when an injury needs a hospital stay.`;
  } else if (s.care === 'admitted') {
    headline = `Yes — ${p.name} covers ${w.poss} hospital stay${label ? ` for ${label}` : ''}${withRoute(routePhrase(primary, s))}.`;
  } else if (s.care === 'incident') {
    headline = `Yes — if ${w.noun} ${w.is} admitted, ${p.name} covers ${what}${s.accident ? ' from day one' : ''}${withRoute(routePhrase(primary, s))}.`;
  } else if (s.care === 'planned') {
    headline = `Yes — ${p.name} covers ${w.poss} ${label ?? 'planned treatment'}, and it can be cashless if approved ${primary.preauthHours ? `${primary.preauthHours} hours ` : ''}before admission.`;
  } else if (oop !== undefined && c) {
    headline = oop > 0
      ? `Not all of it — ${p.name} would pay about ${inr(c.estimatedInsurerShare ?? 0)} of the ${c.inputs[0]?.value ?? ''} bill, leaving about ${inr(oop)} for you.`
      : `Yes — ${p.name} would pay the full ${c.inputs[0]?.value ?? ''} bill${forWho}, as long as the room and every item are within the policy limits.`;
  } else if (s.care === 'discharged' || s.payCash) {
    headline = chronic
      ? cap(`if ${w.subBe} admitted to hospital, ${p.name} reimburses ${w.poss} ${label} treatment when you claim within ${primary.docsDays ?? 30} days of discharge.`)
      : `Yes — ${p.name} reimburses ${w.poss} ${label ? `${label} bills` : 'hospital bills'} when you claim within ${primary.docsDays ?? 30} days of discharge.`;
  } else {
    let q = '';
    if (chronic) q = ` when ${w.subBe} admitted to hospital`;
    else if (primary.copayPercent) { q = `, with a ${primary.copayPercent}% co-pay`; inHeadline.copay = true; }
    else if (primary.sublimit?.amount) {
      // A sub-limit on part of the treatment ("Angioplasty and bypass procedures are limited to…") is named, not implied for all of it
      const subject = primary.sublimit.text.match(/^(.+?) (?:are|is) (?:limited|capped)/)?.[1];
      const whole = !subject || subject.toLowerCase().startsWith((label ?? '').split(' ')[0]);
      q = whole
        ? `, up to ${inr(primary.sublimit.amount)}${/eye/.test(primary.sublimit.text) ? ' per eye' : /delivery/.test(primary.sublimit.text) ? ' per delivery' : ''}`
        : `, with ${lc(subject!)} capped at ${inr(primary.sublimit.amount)} a year`;
      inHeadline.sublimit = true;
    }
    else if (s.topic?.kind === 'benefit' && primary.mainClause?.amount) q = `, up to ${inr(primary.mainClause.amount)} per hospitalisation`;
    headline = `Yes — ${p.name} covers ${what}${forWho}${q}.`;
  }

  // A named policy that doesn't cover it: answer about that policy first
  const namedA = named.length === 1 ? list.find((a) => a.policyId === named[0]) : undefined;
  if (namedA && namedA !== primary) {
    const why = namedA.factors.find((x) => (x.status === 'risk' && x.impact !== 'reduces') || x.status === 'unknown');
    if (why) { headline = `Not ${namedA.policyName} — its ${lc(why.summary)}, but ${p.name} covers ${what}${primary.sublimit?.amount ? `, up to ${inr(primary.sublimit.amount)}` : ''}.`; inHeadline.sublimit = true; o.point = undefined; }
  }
  // A declared-or-not question where one policy is at risk
  const undeclared = list.find((a) => a.factors.some((x) => x.id === 'disclosure' && x.status === 'risk'));
  if (undeclared && undeclared !== primary) headline = `${p.name} still pays, since it asked no health questions — but under ${undeclared.policyName} an undeclared condition can get the claim rejected.`;
  if (guarantee) headline = `Only the insurer can approve a claim, but ${p.name} does cover ${what}${forWho}.`;

  // ---- key points: what matters right now ----
  const pts: string[] = [];
  const intimation = primary.factors.find((x) => x.id === 'intimation');
  const network = primary.factors.find((x) => x.id === 'network');
  const disclosure = primary.factors.find((x) => x.id === 'disclosure' && x.status !== 'clear');
  const waiting = primary.factors.find((x) => x.id === 'waiting-period');
  const nets = listJoin(primary.network.map(shortHosp));
  const paid = s.care === 'discharged' || (s.payCash && !inCare);
  const ded = deductions(primary, inHeadline);

  if (inCare && intimation) pts.push(`${s.care === 'emergency_now' ? 'After admission, tell' : 'Tell'} ${deskOf(p)} within ${primary.intimationHours} hours: ${contactOf(p)}.`);
  if (s.care === 'planned') pts.push(`Cashless at ${nets}. The hospital’s insurance desk sends the approval request (pre-authorisation).`);
  else if (inCare && network?.status === 'check' && !s.hospital && !s.nonNetworkHospital) pts.push(`Cashless at ${nets}. Anywhere else, pay and claim reimbursement within ${primary.docsDays ?? 30} days of discharge.`);
  else if (inCare && network && s.hospital && primary.inNetwork === false) pts.push(`Cashless hospitals for ${p.name}: ${nets}.`);
  if (paid) pts.push('Keep the discharge summary, itemised bills and receipts, prescriptions and test reports.');
  if (chronic && primary.factors.some((x) => x.id === 'needs-admission')) pts.push('Only hospital stays are covered, not routine medicines, tests or doctor visits.');
  if (disclosure) pts.push(s.preExisting || chronic ? `${cap(cond)} must have been declared when you bought ${p.name}, or the claim can be rejected.` : `If ${cond} existed before you bought ${p.name}, it must have been declared, or the claim can be rejected.`);
  if (undeclared && undeclared !== primary) pts.push(`Tell ${byId(undeclared.policyId).provider} in writing now. A waiting period or higher premium is better than a rejected claim.`);
  if ((s.topic?.id === 'cancer' || s.topic?.id === 'dialysis') && clauseWith(p, 'benefit', ['day care'])) pts.push(`${s.topic.id === 'cancer' ? 'Chemotherapy counts' : 'Dialysis counts'} as day care, so no 24-hour stay is needed (${clauseWith(p, 'benefit', ['day care'])!.section}).`);
  // The amount is already in the headline: say what it depends on instead of repeating the clause
  if (s.topic?.kind === 'benefit' && primary.mainClause) pts.push(primary.mainClause.amount ? `Paid only alongside a covered hospital stay (${primary.mainClause.section}).` : `${primary.mainClause.text.replace(/\.$/, '')} (${primary.mainClause.section}).`);
  if (waiting?.status === 'clear' && s.care === 'none' && !s.accident && /\d+-month wait/.test(waiting.summary) && !s.bill) pts.push(`The ${lc(waiting.summary)}.`);
  if (waiting?.status === 'clear' && s.topic?.kind === 'maternity' && /day one/.test(waiting.summary)) pts.push('No waiting period: it’s covered from day one.');
  if (c?.sufficientData) pts.push(costPoint(c, primary));
  else if (ded.length) pts.push(`You’d pay ${listJoin(ded)}.`);
  else if (s.wantsCost || s.bill) pts.push('Tell me the hospital estimate and I’ll work out your share.');
  if (s.care === 'none' && !s.payCash && pts.length < 2 && s.topic?.kind !== 'benefit') pts.push(`Cashless at ${nets}. Elsewhere, pay and claim reimbursement within ${primary.docsDays ?? 30} days of discharge.`);
  if (o.point) pts.push(o.point);

  const factors = orderFactors([...primary.factors, ...o.factors]);
  const confidence = rate(verdict, factors);
  if (guarantee) verdict = verdict === 'yes' ? 'likely' : verdict;

  // ---- details: only what's relevant to this situation ----
  const details: AnswerSection[] = [];
  const reimb = paid || s.payCash || primary.inNetwork === false || s.nonNetworkHospital;
  if ((inCare || s.care === 'planned' || s.wantsCashless) && !reimb) details.push(cashlessSection(p));
  if (reimb || s.care === 'admitted') details.push(reimbursementSection(p));
  if (disclosure || undeclared) { const d = disclosureSection(byId((undeclared ?? primary).policyId)); if (d) details.push(d); }
  if (primary.factors.some((x) => x.id === 'room-rent') && (inCare || s.care === 'planned' || s.wantsCost || s.bill)) details.push({ id: 'room-rent', title: 'How the room rent limit works', body: primary.factors.find((x) => x.id === 'room-rent')!.detail ?? '' });
  if (other?.outcome === 'covered' && s.topic?.kind !== 'benefit') details.push(twoPoliciesSection(w, primary, other));
  if (other?.outcome === 'waiting') { const ws = waitingSection(other); if (ws) details.push(ws); }

  // A plan only where steps genuinely help: before a planned admission, and after paying the bill
  if (s.care === 'planned') col.call('generateActionPlan', { scenario: message, policyIds: [p.id], mode: 'planned' });
  else if (s.care === 'discharged') col.call('generateActionPlan', { scenario: message, policyIds: [p.id], mode: 'reimbursement' });

  return col.answer('', {
    headline, verdict, keyPoints: pts, confidence, details, safetyNotice, primaryPolicyId: p.id,
    suggestions: healthSuggestions(s, w, primary),
  });
}

function notCovered(col: Collector, s: Situation, w: Who, list: PolicyAssessment[], guarantee: boolean, safetyNotice?: string): AgentAnswer {
  const insured = list.filter((a) => a.outcome !== 'not_insured');
  const label = s.topic?.label ?? 'this';
  const both = insured.length > 1 ? 'both your health policies' : insured[0].policyName;
  const waiting = insured.filter((a) => a.outcome === 'waiting').sort((a, b) => (a.waitEnds ?? '').localeCompare(b.waitEnds ?? ''));
  const excluded = insured.filter((a) => a.outcome === 'excluded');
  const unknown = insured.filter((a) => a.outcome === 'not_mentioned');
  const exception = insured.some((a) => a.exception === 'accident');
  const forWho = s.persons.length && !w.self ? ` for ${w.noun}` : '';
  const plural = /s$/.test(label) && !/surgery|treatment|diabetes/.test(label);
  let headline: string;
  let verdict: Verdict = 'no';
  if (unknown.length && !waiting.length && !excluded.length) {
    verdict = 'depends';
    headline = `Unclear — ${unknown.length > 1 ? 'neither of your health policies mentions' : `${unknown[0].policyName} doesn’t mention`} ${label}, so ask the insurer before treatment.`;
  } else if (excluded.some((a) => a.factors.some((x) => x.id === 'disclosure' && x.status === 'risk'))) {
    const a = excluded.find((x) => x.factors.some((y) => y.id === 'disclosure' && y.status === 'risk'))!;
    verdict = 'unlikely';
    headline = `Probably not under ${a.policyName} — an undeclared pre-existing condition can get the claim rejected and the policy cancelled.`;
  } else if (waiting.length && excluded.length) {
    headline = `No — ${excluded[0].policyName} excludes ${label}, and ${waiting[0].policyName}’s waiting period runs till ${fmtDate(waiting[0].waitEnds!)}.`;
  } else if (waiting.length) {
    headline = `Not yet — ${waiting[0].policyName}’s waiting period for ${label}${forWho} runs till ${fmtDate(waiting[0].waitEnds!)}.`;
  } else {
    headline = `No — ${label} ${plural ? 'are' : 'is'} excluded under ${both}${exception ? ', unless an accident needs a hospital stay' : ''}${forWho}.`;
  }
  if (guarantee) headline = `I can’t promise that, and the policy wording says no: ${lc(headline.replace(/^(No|Not yet) — /, ''))}`;

  const pts: string[] = [];
  const reasons = insured.map((a) => ({ a, why: a.factors.find((x) => (x.status === 'risk' && x.impact !== 'reduces') || x.status === 'unknown') }));
  const distinct = new Set(reasons.map((r) => r.why?.summary.replace(/ \((Section|Clause) [\d.]+\)/, '')));
  if (insured.length > 1 && distinct.size > 1) for (const { a, why } of reasons) if (why) pts.push(`${a.policyName}: ${lc(why.summary)}.`);
  if (waiting.some((a) => /accident/i.test(a.mainClause?.text ?? ''))) pts.push('If it’s needed because of an accident, the waiting period doesn’t apply.');
  // The accident exception is already in the headline
  if (!exception && s.topic?.id === 'opd') pts.push('Hospital stays of 24 hours or more and day care procedures are still covered.');
  if (unknown.length) pts.push(`Ask ${listJoin(unknown.map((a) => contactOf(byId(a.policyId))))} to confirm before treatment.`);
  const notIns = list.filter((a) => a.outcome === 'not_insured');
  if (notIns.length && !w.self) pts.push(`${w.Noun} ${w.isnt} insured under ${listJoin(notIns.map((a) => a.policyName))}.`);
  if (!pts.length && waiting.length) pts.push(`It’s covered from ${fmtDate(waiting[0].waitEnds!)}, as long as you renew without a break.`);

  const factors = orderFactors(insured.flatMap((a) => a.factors.filter((x) => x.status !== 'clear' || x.id === 'insured').map((x) => ({ ...x, id: `${x.id}-${a.policyId.toLowerCase()}`, label: insured.length > 1 ? `${a.policyName} · ${x.label}` : x.label }))));
  const details: AnswerSection[] = [];
  for (const a of waiting) { const ws = waitingSection(a); if (ws) details.push(ws); }
  for (const a of excluded) { const d = disclosureSection(byId(a.policyId)); if (d && a.factors.some((x) => x.id === 'disclosure')) details.push(d); }
  details.push(rejectedSection(insured.map((a) => byId(a.policyId))));
  return col.answer('', {
    headline, verdict, keyPoints: pts, confidence: rate(verdict, factors), details, safetyNotice,
    suggestions: healthSuggestions(s, w, undefined, s.topic?.kind === 'excluded' ? ['Compare my health policies'] : []),
  });
}

function notInsured(col: Collector, s: Situation, w: Who, list: PolicyAssessment[], safetyNotice?: string): AgentAnswer {
  const inCare = s.care !== 'none' && s.care !== 'planned';
  const headline = `No — ${w.noun} ${w.isnt} on any of your policies${inCare ? ', so this hospital bill isn’t covered' : ''}.`;
  const pts: string[] = [`Your health policies cover ${coveredPeople()}.`];
  const parentLike = w.person === 'mother' || w.person === 'father' || w.person === 'inlaw';
  const enrol = EMPLOYER && clauseWith(EMPLOYER, 'condition', ['add member']);
  const fAdd = FLOATER && clauseWith(FLOATER, 'condition', ['add member']);
  if (parentLike) {
    if (enrol && /parents/i.test(enrol.text)) pts.push(`You can add ${w.obj} to ${EMPLOYER!.name} in the March enrolment window, with cover from ${fmtDate(nextApril1())}.`);
    if (fAdd && w.person !== 'inlaw') pts.push(`Or add ${w.obj} to ${FLOATER!.name} at renewal (${fmtDate(FLOATER!.renewalDate)}), with medical checks and fresh waiting periods.`);
  } else if (w.person === 'daughter' || w.person === 'other') {
    pts.push(`A newborn can be added within 30 days of birth (${EMPLOYER?.name}) or 90 days (${FLOATER?.name}).`);
  } else {
    pts.push(`Neither policy lets you add ${w.noun.replace(/^your /, 'a ')}, so ${w.sub}’d need ${w.his} own health policy.`);
  }
  if (inCare) pts.push(`Check if ${w.sub} ${w.subHas} cover of ${w.his} own, such as a personal policy or Ayushman Bharat PM-JAY (for anyone 70 or older).`);
  const factors = list.map((a) => ({ ...a.factors[0], id: `insured-${a.policyId.toLowerCase()}`, label: a.policyName }));
  const addIds = parentLike ? [enrol?.id, fAdd?.id].filter((x): x is string => !!x) : [];
  return col.answer('', {
    headline, verdict: 'no', keyPoints: pts, confidence: { ...rate('no', factors), reason: `Neither policy lists ${w.noun} as an insured member.` },
    details: [addMemberSection()], safetyNotice, evidenceIds: addIds,
    suggestions: [parentLike ? `How do I add ${w.my} to my health insurance?` : 'Who is covered under my health policies?', 'Compare my health policies'],
  });
}

function multiPerson(col: Collector, s: Situation, groups: { w: Who; list: PolicyAssessment[] }[], safetyNotice: string | undefined): AgentAnswer {
  const parts: string[] = [];
  const pts: string[] = [];
  const factors: ConfidenceFactor[] = [];
  let covered = 0;
  for (const { w, list } of groups) {
    const short = w.Noun.replace(/^Your /, '');
    const primary = pickPrimary(list);
    if (primary) {
      covered++;
      parts.push(`${w.noun} ${w.is} covered by ${primary.policyName}`);
      pts.push(`${w.Noun}: ${primary.policyName}${primary.copayPercent ? `, with a ${primary.copayPercent}% co-pay` : ''}.${primary.intimationHours && s.care !== 'none' ? ` Tell ${deskOf(byId(primary.policyId))} within ${primary.intimationHours} hours.` : ''}`);
      for (const x of primary.factors.filter((y) => y.status !== 'clear' || y.id === 'insured')) factors.push({ ...x, id: `${w.person}-${x.id}`, label: `${short} · ${x.label}` });
    } else if (list.every((a) => a.outcome === 'not_insured')) {
      parts.push(`${w.noun} ${w.isnt} on any of your policies`);
      pts.push(`${w.Noun}: not on any of your policies${s.care !== 'none' && s.care !== 'planned' ? ', so this bill isn’t covered' : ''}.`);
      // Certain, and already reflected in the 'partial' verdict: it narrows the answer rather than putting it in doubt
      factors.push({ id: `${w.person}-insured`, label: `${short} · Who is insured`, status: 'risk', impact: covered || groups.some((g) => pickPrimary(g.list)) ? 'reduces' : 'blocks', summary: `${w.Noun} ${w.isnt} insured under any policy` });
    } else {
      const why = list.flatMap((a) => a.factors).find((x) => x.status === 'risk' && x.impact !== 'reduces');
      parts.push(`${w.noun} ${w.isnt} covered for this`);
      pts.push(`${w.Noun}: ${why ? lc(why.summary) : 'not covered'}.`);
      if (why) factors.push({ ...why, id: `${w.person}-${why.id}`, label: `${short} · ${why.label}` });
    }
  }
  const verdict: Verdict = covered === groups.length ? 'likely' : covered === 0 ? 'no' : 'partial';
  const mixed = covered > 0 && covered < groups.length;
  const headline = cap(`${parts.length === 2 ? parts.join(mixed ? ', but ' : ', and ') : listJoin(parts)}.`);
  return col.answer('', {
    headline, verdict, keyPoints: pts, confidence: rate(verdict, orderFactors(factors)), safetyNotice,
    details: groups.some(({ list }) => list.every((a) => a.outcome === 'not_insured')) ? [addMemberSection()] : undefined,
    suggestions: groups.filter(({ w }) => !w.self).slice(0, 2).map(({ w }) => `Is ${w.my} covered?`),
  });
}

// ---------- health topics answered from one or two clauses ----------

export type HealthTopic = 'network' | 'renewal' | 'portability' | 'add_member' | 'job' | 'copay' | 'room' | 'sum_left' | 'disclosure' | 'documents' | 'cashless_how' | 'reimbursement_how' | 'rejected' | 'guarantee';

export function runHealthTopic(col: Collector, message: string, kind: HealthTopic, s: Situation): AgentAnswer {
  const f = FLOATER!;
  const g = EMPLOYER!;
  const ids = HEALTH.map((p) => p.id);
  const tags: Record<HealthTopic, string[]> = {
    network: ['network', 'cashless'], renewal: ['renewal', 'grace', 'employment'], portability: ['portability', 'employment'],
    add_member: ['add member', 'newborn'], job: ['employment'], copay: ['copay', 'co-pay'], room: ['room rent'], sum_left: [],
    disclosure: ['disclosure', 'underwriting', 'pre-existing'], documents: ['claim', 'documents', 'reimbursement', 'intimation'],
    cashless_how: ['cashless', 'network', 'pre-authorisation'], reimbursement_how: ['reimbursement', 'documents', 'intimation'],
    rejected: ['grievance', 'rejected', 'ombudsman'], guarantee: ['claim', 'documents'],
  };
  col.call('searchPolicies', { query: message, category: 'health' });
  retrieve(col, ids, tags[kind]);
  const w = s.person && s.person !== 'self' ? Who.of(s, s.person) : undefined;

  switch (kind) {
    case 'network': {
      const forWho = w ? HEALTH.filter((p) => p.insured.some((i) => new RegExp(`\\(${w.person}\\)`).test(i))) : HEALTH;
      if (!forWho.length) return notInsuredShort(col, w!);
      if (s.hospital) {
        const has = forWho.filter((p) => networkList(p).some((h) => h.toLowerCase().includes(s.hospital!)));
        const name = shortHosp(HEALTH.flatMap(networkList).find((h) => h.toLowerCase().includes(s.hospital!)) ?? cap(s.hospital));
        const headline = has.length === forWho.length
          ? `Yes — ${name} is cashless under ${forWho.length > 1 ? 'both your health policies' : forWho[0].name}${w ? ` for ${w.noun}` : ''}.`
          : has.length ? `Only under ${has[0].name} — ${name} isn’t in ${forWho.filter((p) => !has.includes(p)).map((p) => p.name).join(' or ')}’s network.`
          : `No — ${name} isn’t cashless under ${forWho.map((p) => p.name).join(' or ')}${w ? ` for ${w.noun}` : ''}, but you can still pay and claim reimbursement.`;
        return col.answer('', {
          headline, verdict: has.length ? (has.length === forWho.length ? 'yes' : 'partial') : 'no',
          keyPoints: [has.length ? 'Show your health card at the hospital’s insurance (TPA) desk when you’re admitted.' : 'Claim within 30 days of discharge.', ...forWho.map((p) => `${p.name} network: ${listJoin(networkList(p).map(shortHosp))}.`)],
          details: [has.length ? cashlessSection(has[0]) : reimbursementSection(forWho[0])],
          evidenceIds: forWho.map((p) => clauseWith(p, 'condition', ['network'])?.id).filter((x): x is string => !!x),
          suggestions: ['I have a planned surgery next month. How do I get cashless treatment?', 'What documents do I need for a health claim?'],
        });
      }
      return col.answer('', {
        headline: `Cashless${w ? ` for ${w.noun}` : ''} in Pune: ${listJoin([...new Set(forWho.flatMap(networkList))].map(shortHosp))}.`,
        verdict: 'info',
        keyPoints: [...(forWho.length > 1 ? forWho.map((p) => `${p.name}: ${listJoin(networkList(p).map(shortHosp))}.`) : [`Through ${forWho[0].name}${w ? `, the only policy that covers ${w.obj}` : ''}.`]), 'Any other hospital: pay and claim reimbursement within 30 days of discharge.'],
        details: [cashlessSection(forWho[0])],
        evidenceIds: forWho.map((p) => clauseWith(p, 'condition', ['network'])?.id).filter((x): x is string => !!x),
        suggestions: ['Can I go to Riverside Multispeciality for cashless?', 'I have a planned surgery next month. How do I get cashless treatment?'],
      });
    }
    case 'renewal': {
      const r = clauseWith(f, 'condition', ['grace']);
      const graceEnd = fmtDate(addDays(f.renewalDate, 30));
      const missed = /\b(missed|miss|forgot|lapsed?|didn'?t (pay|renew)|late)\b/.test(s.raw);
      return col.answer('', {
        headline: missed
          ? `${f.name} is active till ${fmtDate(f.renewalDate)} — if you miss a renewal, you get 30 days’ grace to pay and keep your waiting-period credit.`
          : `${f.name} renews on ${fmtDate(f.renewalDate)}, and your employer renews ${g.name} on ${fmtDate(g.renewalDate)}.`,
        verdict: 'info',
        keyPoints: [
          missed ? `Grace for this renewal runs till ${graceEnd}.` : `Grace period: 30 days, till ${graceEnd}. You keep your waiting-period credit.`,
          'Treatment while the premium is unpaid isn’t covered, even during the grace period.',
          'Miss the grace period and the policy lapses, so waiting periods start again.',
        ],
        details: r ? [{ id: 'renewal', title: `${f.name}: renewal wording`, body: `**${r.section}:** ${r.text}` }] : undefined,
        evidenceIds: r ? [r.id] : [],
        suggestions: ['Can I port my family floater to another insurer?', 'If I leave my job, do I lose the group health cover?'],
      });
    }
    case 'portability': {
      const c = clauseWith(f, 'condition', ['portability']);
      const emp = clauseWith(g, 'condition', ['employment']);
      return col.answer('', {
        headline: `Yes — you can port ${f.name} at renewal if you apply by ${fmtDate(addDays(f.renewalDate, -45))}, 45 days before it renews on ${fmtDate(f.renewalDate)}.`,
        verdict: 'yes',
        keyPoints: [
          'Waiting periods already served carry over, up to your current sum insured.',
          'The new insurer still assesses you, and can decline or charge a higher premium.',
          `${g.name} can’t be ported directly. When you leave the job, you may be offered an individual policy in its place within 30 days.`,
        ],
        confidence: c ? rate('yes', [{ id: 'portability', label: 'Portability', status: 'check', summary: 'The new insurer still decides whether to accept you', clauseIds: [c.id] }]) : undefined,
        details: [{ id: 'portability', title: 'Portability rules', body: [c ? `**${f.name}, ${c.section}:** ${c.text}` : '', emp ? `**${g.name}, ${emp.section}:** ${emp.text}` : ''].filter(Boolean).join('\n\n') }],
        evidenceIds: [c?.id, emp?.id].filter((x): x is string => !!x),
        suggestions: ['When does my family floater renew?', 'Compare my health policies'],
      });
    }
    case 'add_member': {
      const parentLike = w && (w.person === 'mother' || w.person === 'father' || w.person === 'inlaw');
      const baby = /\b(baby|newborn|new born|child)\b/.test(s.raw) && !parentLike;
      const gC = clauseWith(g, 'condition', ['add member']);
      const fC = clauseWith(f, 'condition', ['add member']);
      const already = w ? HEALTH.filter((p) => p.insured.some((i) => new RegExp(`\\(${w.person}\\)`).test(i))) : [];
      if (w && already.length === HEALTH.length) {
        return col.answer('', { headline: `${w.Noun} ${w.is} already covered by both your health policies.`, verdict: 'info', keyPoints: HEALTH.map((p) => `${p.name}: ${p.insured.find((i) => new RegExp(`\\(${w.person}\\)`).test(i))}.`), suggestions: ['Compare my health policies'] });
      }
      const headline = baby
        ? `Add a newborn within 30 days of birth to ${g.name}, or within 90 days to ${f.name}.`
        : parentLike
          ? `Add ${w!.noun} to ${g.name} in the March enrolment window (cover from ${fmtDate(nextApril1())})${w!.person !== 'inlaw' ? `, or to ${f.name} at renewal` : ''}.`
          : `${g.name} adds a new spouse or newborn within 30 days and parents each March; ${f.name} adds members at renewal.`;
      const pts = baby
        ? ['Register the birth with HR or the insurer within the window, or the request waits until renewal.', `Under ${f.name}, waiting periods start fresh for the baby.`]
        : [
            parentLike ? `${g.name}: parents can join only in March, through the HR portal.` : `${g.name}: add a spouse or newborn within 30 days of the marriage or birth.`,
            parentLike && w!.person === 'inlaw' ? `${f.name} covers only your spouse, children and parents, not in-laws.` : `${f.name}: members join at renewal (${fmtDate(f.renewalDate)}) after medical checks, and waiting periods start fresh.`,
            parentLike ? `Parents on ${g.name} have a 20% co-pay on every claim.` : '',
            already.length ? `${w!.Noun} ${w!.is} already on ${already.map((p) => p.name).join(', ')}.` : '',
          ];
      return col.answer('', { headline, verdict: 'info', keyPoints: pts, details: [addMemberSection()], evidenceIds: [gC?.id, fC?.id].filter((x): x is string => !!x), suggestions: ['Is my mother covered?', 'Compare my health policies'] });
    }
    case 'job': {
      const emp = clauseWith(g, 'condition', ['employment'])!;
      const onlyG = g.insured.filter((i) => !f.insured.some((x) => x.split(' (')[0] === i.split(' (')[0]));
      const fWho = listJoin(f.insured.map((i) => (/\((self|employee)\)/.test(i) ? 'you' : firstName(i))));
      return col.answer('', {
        headline: `Yes — ${g.name} ends on your last working day, but you may be offered an individual policy in its place within 30 days.`,
        verdict: 'yes',
        keyPoints: [
          `${f.name} continues, with ${inr(f.sumInsured)} for ${fWho}.`,
          onlyG.length ? `${listJoin(onlyG.map((i) => `Your ${i.match(/\((\w+)\)/)?.[1]} (${firstName(i)})`))} ${onlyG.length > 1 ? 'are' : 'is'} only on the employer plan and would lose cover.` : '',
          'Ask HR about the individual policy before your last day. A new policy may restart waiting periods.',
        ],
        confidence: rate('yes', [{ id: 'employment', label: 'Cover tied to employment', status: 'clear', summary: emp.text, clauseIds: [emp.id] }]),
        details: [addMemberSection()],
        suggestions: ['How do I add my father to my health insurance?', 'Compare my health policies'],
      });
    }
    case 'copay': {
      const cp = g.clauses.find((c) => c.type === 'deductible' && c.percent);
      const waived = /\b(waiv\w*|removed|no co-?pay|uploaded|note|email|letter)\b/.test(s.raw);
      const head = !cp ? 'Neither health policy has a co-pay.'
        : waived ? `No — ${g.name}’s ${cp.percent}% co-pay for parents still applies, because an uploaded note isn’t policy evidence.`
        : `You pay ${cp.percent}% of every claim for your father under ${g.name} — ${f.name} has no co-pay but doesn’t cover him.`;
      return col.answer('', {
        headline: head, verdict: waived ? 'no' : 'info',
        keyPoints: cp ? [
          `On ₹1,00,000 of approved charges, the insurer pays ₹${(100000 - cp.percent! * 1000).toLocaleString('en-IN')} and you pay ₹${(cp.percent! * 1000).toLocaleString('en-IN')}.`,
          'The co-pay is worked out after any sub-limit and room rent deductions.',
          waived ? `Only a written policy endorsement from ${g.provider} can change it. Ask HR for one.` : 'You, Meera and Kabir have no co-pay on either policy.',
        ] : [],
        confidence: cp && waived ? rate('no', [{ id: 'co-pay', label: 'Co-pay', status: 'risk', impact: 'reduces', summary: cp.text, clauseIds: [cp.id] }]) : undefined,
        evidenceIds: cp ? [cp.id] : [],
        suggestions: ['My father’s hospital bill is ₹4 lakh for a cardiac procedure. How much will I pay?', 'Is my father covered?'],
      });
    }
    case 'room': {
      const fr = clauseWith(f, 'limit', ['room rent']);
      const gr = clauseWith(g, 'limit', ['room rent']);
      const upgrade = /\b(upgrade|extra|cost|bigger|suite|private room|deluxe)\b/.test(s.raw);
      return col.answer('', {
        headline: upgrade
          ? 'It can — a room above your limit reduces the whole claim in proportion, not just the room charge.'
          : `${f.name} allows up to a single private room, and ${g.name} up to ${inr(gr?.amount ?? 0)} a day (ICU ${inr(10000)}).`,
        verdict: upgrade ? 'depends' : 'info',
        keyPoints: [
          ...(upgrade ? [fr ? `${f.name}: up to a single private room.` : '', gr ? `${g.name}: up to ${inr(gr.amount ?? 0)} a day (ICU ${inr(10000)}).` : ''] : ['Go above the limit and most of the bill is cut in the same proportion, not just the room charge.']),
          'Pick a room within the limit. The hospital can tell you which room category you’re eligible for.',
        ],
        confidence: upgrade ? rate('depends', [
          ...(fr ? [{ id: 'room-floater', label: f.name, status: 'check' as const, summary: 'A room above single private reduces the whole claim', clauseIds: [fr.id] }] : []),
          ...(gr ? [{ id: 'room-employer', label: g.name, status: 'check' as const, summary: `A room above ${inr(gr.amount ?? 0)} a day reduces the whole claim`, clauseIds: [gr.id] }] : []),
        ]) : undefined,
        details: gr ? [{ id: 'room-rent', title: 'How proportionate deduction works', body: `**Example (${g.name}):** the limit is ${inr(gr.amount!)} a day and you take a ₹10,000 room. The insurer then pays only 50% of most charges, such as doctor fees, procedures and nursing. On a ₹2,00,000 bill, that can leave you paying ₹1,00,000, far more than the ₹5,000-a-day room difference.\n\nMedicines and implants are usually paid in full.` }] : undefined,
        evidenceIds: [fr?.id, gr?.id].filter((x): x is string => !!x),
        suggestions: ['How much will I pay if my hospital bill is ₹2 lakh?', 'Compare my health policies'],
      });
    }
    case 'sum_left': {
      const pts = HEALTH.map((p) => { const u = sumInsuredUsed(p, portfolio.claims); return `${p.name}: ${inr(p.sumInsured - u.used)} of ${inr(p.sumInsured)} left${u.used ? ` (after ${u.claims.map((c) => `${c.title.split(' —')[0]}’s ${inr(c.amountSettled ?? c.amountClaimed)} claim`).join(', ')})` : ''}.`; });
      const total = HEALTH.reduce((s2, p) => s2 + p.sumInsured - sumInsuredUsed(p, portfolio.claims).used, 0);
      return col.answer('', { headline: `You have ${inr(total)} of health cover left this policy year, across both policies.`, verdict: 'info', keyPoints: [...pts, 'Both are family covers, so everyone on a policy shares its amount.'], suggestions: ['Compare my health policies', 'How much will I pay if my hospital bill is ₹3 lakh?'] });
    }
    case 'disclosure': {
      const fd = clauseWith(f, 'condition', ['disclosure']);
      const gd = clauseWith(g, 'condition', ['underwriting']);
      const mor = fd?.text.match(/(\d+) months of continuous coverage, counted from (\d{4}-\d{2}-\d{2})/);
      const morEnds = mor ? (() => { const d = new Date(mor[2] + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + Number(mor[1])); return d.toISOString().slice(0, 10); })() : undefined;
      const factors: ConfidenceFactor[] = [
        ...(fd ? [{ id: 'disclosure-floater', label: f.name, status: 'risk' as const, impact: 'blocks' as const, summary: `An undeclared condition can be challenged${morEnds ? ` until ${fmtDate(morEnds)}` : ''}`, clauseIds: [fd.id] }] : []),
        ...(gd ? [{ id: 'disclosure-employer', label: g.name, status: 'clear' as const, summary: 'No health questions, so nothing to declare', clauseIds: [gd.id] }] : []),
      ];
      return col.answer('', {
        headline: `Under ${f.name}, the claim can be rejected and the policy cancelled${morEnds ? ` until ${fmtDate(morEnds)}` : ''} — ${g.name} isn’t affected.`,
        verdict: 'unlikely',
        keyPoints: [
          'The insurer checks hospital records and old prescriptions at claim time.',
          morEnds ? `From ${fmtDate(morEnds)}, after 60 months of continuous cover, only proven fraud can be raised.` : '',
          'Tell the insurer in writing now. A waiting period or higher premium is better than a rejected claim.',
          `${g.name} asked no health questions, so it pays as usual.`,
        ],
        confidence: rate('unlikely', factors),
        details: [disclosureSection(f), rejectedSection([f])].filter((x): x is AnswerSection => !!x),
        suggestions: ['I have diabetes, if I get treated and pay cash will I be reimbursed?', 'My health claim was rejected. What can I do?'],
      });
    }
    case 'documents':
    case 'reimbursement_how': {
      col.call('generateActionPlan', { scenario: message, policyIds: [f.id], mode: 'reimbursement' });
      return col.answer('', {
        headline: kind === 'documents'
          ? 'Send the claim form, discharge summary, itemised bills and receipts, prescriptions and reports within 30 days of discharge.'
          : 'Pay the hospital, then submit the claim form, discharge summary, bills and reports within 30 days of discharge.',
        verdict: 'info',
        keyPoints: [
          `${f.name}: send them to ${contactOf(f)}, and follow-up bills within 15 days of finishing treatment.`,
          `${g.name}: tell the insurer’s claims desk (TPA) through the HR portal, with the patient’s ID and your employee ID.`,
          'Late? Submit anyway with a written reason. Justified delays are accepted.',
        ],
        details: [reimbursementSection(f, 'reimbursement', `${f.name}: reimbursement`), reimbursementSection(g, 'reimbursement-employer', `${g.name}: reimbursement`)],
        suggestions: ['My health claim was rejected. What can I do?', 'Which hospitals in Pune are cashless?'],
      });
    }
    case 'cashless_how': {
      col.call('generateActionPlan', { scenario: message, policyIds: [f.id], mode: 'planned' });
      const fd = clauseWith(f, 'condition', ['intimation'])?.text.match(/(\d+) hours before/)?.[1];
      const gd = clauseWith(g, 'condition', ['intimation'])?.text.match(/(\d+) hours before/)?.[1];
      return col.answer('', {
        headline: 'Go to a network hospital and show your health card at the insurance (TPA) desk — for a planned stay, get approval in advance.',
        verdict: 'info',
        keyPoints: [`Planned stays need approval (pre-authorisation) ${fd ?? 48} hours ahead under ${f.name} and ${gd ?? 72} hours under ${g.name}.`, 'Emergency admissions: tell the insurer within 24 hours.', `Network hospitals: ${listJoin([...new Set(HEALTH.flatMap(networkList))].map(shortHosp))}.`],
        details: [cashlessSection(f, 'cashless', `${f.name}: cashless`), cashlessSection(g, 'cashless-employer', `${g.name}: cashless`)],
        suggestions: ['Can I go to Riverside Multispeciality for cashless?', 'What documents do I need for a health claim?'],
      });
    }
    case 'rejected': {
      const nd = /\b(non-?disclosure|not disclosed|undisclosed|pre-?existing|undeclared)\b/.test(s.raw);
      return col.answer('', {
        headline: 'You can challenge it — ask for the reason in writing, reply with evidence, then take it to the Grievance Officer.',
        verdict: 'info',
        keyPoints: [
          nd ? 'If the condition started after you bought the policy, send the doctor’s records showing the diagnosis date.' : '',
          'The Grievance Officer must reply within 14 days.',
          'Not resolved in 30 days? Complain on IRDAI’s Bima Bharosa portal or to the Insurance Ombudsman (free, for claims up to ₹50 lakh).',
          'File with the Ombudsman within 1 year of the insurer’s final reply.',
        ],
        details: [rejectedSection(HEALTH), disclosureSection(f)].filter((x): x is AnswerSection => !!x),
        evidenceIds: HEALTH.map((p) => clauseWith(p, 'condition', ['grievance'])?.id).filter((x): x is string => !!x),
        suggestions: ['What if a condition wasn’t declared when I bought the policy?', 'What documents do I need for a health claim?'],
      });
    }
    case 'guarantee':
      return col.answer('', {
        headline: 'I can’t promise any claim will be approved — only the insurer decides, after reviewing the documents.',
        verdict: 'info',
        keyPoints: ['What helps: tell the insurer on time, stay within the room rent limit and sub-limits, and send complete documents within 30 days.', 'Tell me who it’s for and what happened, and I’ll check every condition that could affect it.'],
        suggestions: ['My father is admitted in hospital for a heart problem', 'I have diabetes, if I get treated and pay cash will I be reimbursed?', 'What documents do I need for a health claim?'],
      });
  }
}

function notInsuredShort(col: Collector, w: Who): AgentAnswer {
  return col.answer('', { headline: `${w.Noun} ${w.isnt} on any of your health policies, so no hospital is cashless for ${w.obj}.`, verdict: 'no', keyPoints: [`Your health policies cover ${coveredPeople()}.`], suggestions: [`How do I add ${w.my} to my health insurance?`] });
}

// ---------- term life ----------

export type LifeTopic = 'payout' | 'suicide' | 'abroad' | 'accident' | 'rider' | 'premium' | 'disclosure' | 'nominee_change' | 'claim' | 'no_health' | 'rejected';

export function runLife(col: Collector, message: string, kind: LifeTopic): AgentAnswer {
  const p = LIFE[0];
  if (!p) return col.answer('', { headline: 'You have no term life policy in your portfolio.', verdict: 'info' });
  col.call('searchPolicies', { query: message, category: 'life' });
  const tags: Record<LifeTopic, string[]> = {
    payout: ['death', 'nominee', 'accidental death'], suicide: ['suicide', 'revival'], abroad: ['worldwide', 'death'], accident: ['accidental death', 'rider exclusion'], rider: ['accidental death', 'rider exclusion'],
    premium: ['grace', 'revival', 'lapse'], disclosure: ['section 45', 'disclosure', 'smoking'], nominee_change: ['nominee', 'nomination'], claim: ['claim', 'documents', 'claim settlement'],
    no_health: ['critical illness', 'hospital'], rejected: ['grievance', 'section 45'],
  };
  retrieve(col, [p.id], tags[kind]);
  const r = col.call('assessClaimFactors', { policyIds: [p.id], scenario: message });
  const a: LifeAssessment = r.life[0];
  const ctx = readLifeContext(message);
  const nominee = a.nominee ?? 'your nominee';
  const proc = p.clauses.find((c) => c.type === 'claim_process');
  const settle = clauseWith(p, 'condition', ['claim settlement']);
  const rider = clauseWith(p, 'benefit', ['accidental death']);
  const deathClaim: AnswerSection = {
    id: 'death-claim', title: 'How the nominee claims', summary: settle?.text.match(/within \d+ days of receiving all documents/i)?.[0],
    body: [
      `1. **Tell ${p.provider}** on ${contactOf(p)}, quoting policy no. ${p.policyNumber}.`,
      `2. **Submit:** ${proc?.text ?? 'claim form, death certificate, policy document, nominee ID and bank details.'}`,
      '3. **For an accidental death**, the insurer usually asks for the police FIR, post-mortem report and final investigation report.',
      settle ? `4. **Settlement:** ${settle.text}` : '',
    ].filter(Boolean).join('\n'),
  };
  const sec45: AnswerSection = { id: 'section-45', title: 'Section 45: when a claim can be questioned', body: a.factors.find((x) => x.id === 'disclosure')?.detail ?? '' };
  const factors = a.factors;
  const healthNote = EMPLOYER && FLOATER ? `${EMPLOYER.name} would end, since it’s tied to your job. ${FLOATER.name} stays as the family’s health cover.` : '';

  switch (kind) {
    case 'payout':
    case 'accident': {
      const accident = kind === 'accident' || ctx.accident;
      const v: Verdict = a.outcome === 'not_covered' ? 'no' : a.outcome === 'reduced' ? 'partial' : 'yes';
      const headline = accident && ctx.intoxication
        ? `${nominee} would still receive ${crore(a.payout)}, but the ${lakhs(rider?.amount ?? 0)} accidental death rider isn’t paid when intoxication is involved.`
        : accident
          ? `${nominee} would receive ${crore(a.payout + (a.riderAmount ?? 0))} — ${crore(a.payout)} cover plus the ${lakhs(a.riderAmount ?? 0)} accidental death rider.`
          : `${nominee}, your nominee, would receive ${crore(a.payout)}${rider?.amount ? `, or ${crore(a.payout + rider.amount)} if the death is from an accident` : ''}.`;
      const pts = [
        `${firstName(nominee)} claims with the claim form, death certificate, policy document, nominee ID and bank details.`,
        settle ? 'The insurer pays within 15 days of getting all documents, or 45 days if it investigates.' : '',
        accident ? 'The rider pays if death follows within 180 days of the accident. It doesn’t pay for intoxication, self-harm, hazardous sports, crime or war.' : `Keep paying premiums. The next one is due on ${fmtDate(a.premiumDue)}.`,
        healthNote,
      ];
      return col.answer('', { headline, verdict: v, keyPoints: pts, confidence: rate(v, factors), details: [deathClaim, sec45], suggestions: ['How does my nominee make a claim on my term life policy?', 'Can I change the nominee on my term policy?', 'I missed my term premium due date, am I still covered?'] });
    }
    case 'rider':
      return col.answer('', {
        headline: rider ? `You have a ${lakhs(rider.amount ?? 0)} accidental death rider, on top of the ${crore(a.payout)} cover.` : `No — ${p.name} has no accidental death rider.`,
        verdict: rider ? 'yes' : 'no',
        keyPoints: rider ? ['Paid if death follows within 180 days of the accident.', 'It isn’t paid for intoxication, self-harm, hazardous sports, crime or war, but the base cover still is.', `Both go to ${nominee}.`] : [],
        evidenceIds: [rider?.id, clauseWith(p, 'exclusion', ['rider exclusion'])?.id].filter((x): x is string => !!x),
        suggestions: ['How much will my nominee get if I die in an accident?', 'What happens to my family if I die?'],
      });
    case 'suicide': {
      const passed = a.suicideTill <= DEMO_TODAY;
      return col.answer('', {
        headline: passed
          ? `Yes — the 12-month suicide clause ended on ${fmtDate(a.suicideTill)}, so ${crore(a.payout)} would be paid to ${nominee}.`
          : `Not yet — until ${fmtDate(a.suicideTill)} only 80% of premiums paid would be refunded.`,
        verdict: passed ? 'yes' : 'no',
        keyPoints: ['If the policy lapses and is revived, the 12-month clause starts again.', 'The accidental death rider never pays for self-inflicted injury.'],
        confidence: rate(passed ? 'yes' : 'no', factors),
        safetyNotice: 'If you’re struggling, you don’t have to face it alone. Call Tele-MANAS on 14416 (free, 24×7), or 112 in an emergency.',
        details: [{ id: 'suicide-clause', title: 'The suicide clause', body: `${clauseWith(p, 'exclusion', ['suicide'])?.text ?? ''}\n\n${clauseWith(p, 'condition', ['revival'])?.text ?? ''}` }],
        suggestions: ['What happens to my family if I die?', 'I missed my term premium due date, am I still covered?'],
      });
    }
    case 'abroad':
      return col.answer('', {
        headline: `Yes — ${p.name} pays ${crore(a.payout)} wherever death occurs, in India or abroad.`,
        verdict: 'yes',
        keyPoints: ['The death certificate must be attested by the Indian embassy or consulate.', 'Keep the passport copy and, for an accident, the local police report.', `Nominee: ${nominee}.`],
        confidence: rate('yes', factors), details: [deathClaim], suggestions: ['What happens to my family if I die?', 'How does my nominee make a claim on my term life policy?'],
      });
    case 'premium': {
      const revival = clauseWith(p, 'condition', ['revival']);
      const t = ctx.raw;
      const headline = /\b(revive|revival|reinstate|lapsed)\b/.test(t)
        ? `Yes — a lapsed policy can be revived within 5 years by paying the missed premiums with interest, and yours is in force until the premium due on ${fmtDate(a.premiumDue)}.`
        : /\b(missed|miss|forgot|not paid|unpaid|late|can'?t pay|stop paying)\b/.test(t)
          ? `Yes — your policy is in force, and if you miss a due date, cover continues through the 30-day grace period.`
          : `30 days — if you miss the premium due on ${fmtDate(a.premiumDue)}, cover continues till ${fmtDate(a.graceEnds)}.`;
      return col.answer('', {
        headline,
        verdict: 'yes',
        keyPoints: [
          `Next premium due ${fmtDate(a.premiumDue)}, with grace till ${fmtDate(a.graceEnds)}.`,
          'Death during the grace period is covered, minus the unpaid premium.',
          'After the grace period the policy lapses and nothing is paid.',
          revival ? 'Reviving restarts the 12-month suicide clause and the 3-year Section 45 period.' : '',
        ],
        confidence: rate('yes', factors),
        details: revival ? [{ id: 'revival', title: 'Reviving a lapsed policy', body: revival.text }] : undefined,
        suggestions: ['What happens to my family if I die?', 'What if I didn’t disclose smoking on my term policy?'],
      });
    }
    case 'disclosure': {
      const past = a.contestableTill <= DEMO_TODAY;
      return col.answer('', {
        headline: past
          ? `Your nominee would still be paid — the 3-year Section 45 window ended on ${fmtDate(a.contestableTill)}, so the policy can’t be questioned for that now.`
          : `It could be rejected — until ${fmtDate(a.contestableTill)} the insurer can question a material misstatement like smoking.`,
        verdict: past ? 'yes' : 'unlikely',
        keyPoints: [
          'The policy was issued on your declaration: non-smoker, no medical history.',
          past ? 'A lapse and revival would restart the 3 years, so keep paying on time.' : 'Tell the insurer now. They may raise the premium rather than reject a claim later.',
          'For any new policy, declare smoking and conditions honestly.',
        ],
        confidence: rate(past ? 'yes' : 'unlikely', factors), details: [sec45],
        suggestions: ['What happens to my family if I die?', 'I missed my term premium due date, am I still covered?'],
      });
    }
    case 'nominee_change': {
      const n = clauseWith(p, 'condition', ['nominee']);
      return col.answer('', {
        headline: `Yes — you can change the nominee any time by sending ${p.provider} a written endorsement request.`,
        verdict: 'info',
        keyPoints: [`Current nominee: ${nominee}, 100%.`, 'The latest registered nomination is the one that counts for the payout.', 'You can split the payout between several nominees; name an appointee for a minor.'],
        details: n ? [{ id: 'nomination', title: 'Nomination wording', body: n.text }] : undefined,
        evidenceIds: n ? [n.id] : [],
        suggestions: ['What happens to my family if I die?', 'How does my nominee make a claim on my term life policy?'],
      });
    }
    case 'claim':
      col.call('generateActionPlan', { scenario: message, policyIds: [p.id], mode: 'death_claim' });
      return col.answer('', {
        headline: `${nominee} files with ${p.provider} using the claim form, death certificate, policy document, nominee ID and bank details.`,
        verdict: 'info',
        keyPoints: [`Call ${contactOf(p)} to start the claim.`, settle ? 'The insurer pays within 15 days of getting all documents, or 45 days if it investigates.' : '', 'For an accidental death, keep the FIR and post-mortem report.'],
        confidence: rate('yes', factors), details: [deathClaim, sec45],
        suggestions: ['What happens to my family if I die?', 'What if a term life claim is rejected?'],
      });
    case 'no_health': {
      const ci = clauseWith(p, 'condition', ['critical illness']);
      const critical = /critical illness/.test(ctx.raw);
      return col.answer('', {
        headline: critical
          ? `No — none of your policies has a critical illness benefit, though your health policies pay hospital bills.`
          : `No — ${p.name} pays only on death, but your health policies cover hospital treatment.`,
        verdict: 'no',
        keyPoints: [`${HEALTH.map((h) => h.name).join(' and ')} cover hospital stays and day care such as chemotherapy.`, critical ? `A critical illness plan pays a lump sum on diagnosis. You don’t have one, and ${p.name} pays only on death.` : 'The term plan has no critical illness or hospitalisation benefit.'],
        confidence: rate('no', ci ? [{ id: 'benefit', label: 'Living benefits', status: 'risk', impact: 'blocks', summary: 'No critical illness or hospitalisation benefit', clauseIds: [ci.id] }] : []),
        suggestions: ['Is cancer treatment covered by my health insurance?', 'Compare my health policies'],
      });
    }
    case 'rejected':
      return col.answer('', {
        headline: `${nominee} can challenge it — first with the Grievance Officer, then with the Insurance Ombudsman.`,
        verdict: 'info',
        keyPoints: [
          `Your policy is past the 3-year Section 45 window (${fmtDate(a.contestableTill)}), so it can’t be questioned for misstatements.`,
          'The Grievance Officer replies within 14 days. Not resolved in 30 days? Go to Bima Bharosa or the Ombudsman.',
          'The Ombudsman handles claims up to ₹50 lakh. For the full ₹1 crore, go to the consumer commission.',
        ],
        details: [{ id: 'rejected', title: 'If the claim is rejected', body: clauseWith(p, 'condition', ['grievance'])?.text ?? '' }, sec45],
        evidenceIds: [clauseWith(p, 'condition', ['grievance'])?.id, clauseWith(p, 'condition', ['section 45'])?.id].filter((x): x is string => !!x),
        suggestions: ['What happens to my family if I die?', 'How does my nominee make a claim on my term life policy?'],
      });
  }
}

function crore(n: number): string {
  return n >= 10000000 ? `₹${(n / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore` : lakhs(n);
}
function lakhs(n: number): string {
  return n >= 100000 ? `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh` : inr(n);
}
