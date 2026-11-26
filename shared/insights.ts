// Home dashboard insights, derived from the scoped portfolio (the same data /api/portfolio returns).
//
// Pure and deterministic: no Node APIs, no network, no clock. Every date comparison uses the `today`
// argument (DEMO_TODAY by default), and every amount, date and person comes from the data — nothing is
// hard-coded per policy. Each item points at the clause or policy it relies on, and every `prompt` is a
// question the local engine answers on topic (checked by `npm run check:insights`).

import type { Clause, ClauseType, Policy, PortfolioData } from './types';
import { DEMO_TODAY } from './demo';

// ---------- public shapes ----------

export type AttentionTone = 'bad' | 'warn' | 'info';

export type AttentionAction =
  | { kind: 'ask'; prompt: string } // open the assistant with this question
  | { kind: 'policy'; policyId: string } // open this policy
  | { kind: 'documents' }; // open the documents list

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  action: AttentionAction;
  actionLabel: string;
  /** The policy the item is about, if any. */
  policyId?: string;
  /** The clause the item relies on, if any. */
  clauseId?: string;
  /** The date the item is about (ISO), if any — e.g. a renewal date. */
  dueDate?: string;
}

export interface CoveragePerson {
  key: string; // stable slug of the name, e.g. "suresh-mehta"
  name: string; // "Suresh Mehta"
  relation: string; // display label: "You", "Spouse", "Son", "Father"
}

export interface CoveragePolicy {
  id: string;
  name: string;
  category: Policy['category'];
}

export interface CoverageCell {
  covered: boolean;
  note?: string; // e.g. "Life assured", "Nominee", "20% co-pay"
}

export interface CoverageMatrix {
  people: CoveragePerson[];
  policies: CoveragePolicy[];
  cells: Record<string, Record<string, CoverageCell>>; // cells[person.key][policy.id]
}

export interface Insight {
  id: string;
  title: string; // at most 6 words
  detail: string; // one line, plain words
  prompt: string; // a question that opens the assistant on this topic
  policyId: string;
  clauseId: string;
  /** Other clauses that say the same thing on other policies (e.g. the OPD exclusion on both health plans). */
  relatedClauseIds?: string[];
}

export interface SummaryFigures {
  /** Sum insured left this policy year across health policies (sum insured minus claims paid this policy year). */
  healthCoverLeft: number;
  /** Total sum insured across health policies. */
  healthCoverTotal: number;
  /** Term life cover (sum assured of the base policies, riders not included). */
  lifeCover: number;
  /** Money paid back by insurers on settled claims. */
  claimedBack: number;
}

// ---------- small helpers ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-07-01" → "1 Jul 2027" (no Intl, so it reads the same in every browser). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** "2027-07-01" → "Jul 2027" */
const monthYear = (iso: string) => formatDate(iso).replace(/^\d+ /, '');

/** Indian digit grouping: 960200 → "₹9,60,200". */
export function formatInr(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}
/** Round amounts in words: 300000 → "₹3 lakh", 10000000 → "₹1 crore"; anything else → formatInr. */
export function formatInrShort(n: number): string {
  if (n >= 1e7 && n % 1e5 === 0) return `₹${trim(n / 1e7)} crore`;
  if (n >= 1e5 && n % 1e3 === 0) return `₹${trim(n / 1e5)} lakh`;
  return formatInr(n);
}
const trim = (x: number) => String(Number(x.toFixed(2)));

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  return t.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to` (negative if `to` is earlier). */
function daysBetween(from: string, to: string): number {
  const ms = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const firstName = (name: string) => name.split(/\s+/)[0];

function clauseWith(p: Policy, types: ClauseType | ClauseType[], tags: string[]): Clause | undefined {
  const ts = Array.isArray(types) ? types : [types];
  return p.clauses.find((c) => ts.includes(c.type) && c.topics.some((x) => tags.includes(x)));
}

/** Sum insured used by claims dated inside the current policy year (same rule as the engine's sumInsuredUsed). */
function sumInsuredUsed(p: Policy, claims: PortfolioData['claims']): number {
  return claims
    .filter((c) => c.policyId === p.id && c.date >= p.startDate && c.date <= p.renewalDate)
    .reduce((s, c) => s + (c.amountSettled ?? c.amountClaimed), 0);
}

/** Reads "N months/days … from YYYY-MM-DD" from a waiting-period clause (same rule as the engine's waitInfo). */
function waitEnds(p: Policy, c: Clause): string | undefined {
  const len = c.text.match(/(\d+)\s*(months?|days?)/i);
  if (!len) return undefined;
  const from = c.text.match(/(?:started|since|from)\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? p.startDate;
  return /month/i.test(len[2]) ? addMonths(from, Number(len[1])) : addDays(from, Number(len[1]));
}

const health = (d: PortfolioData) => d.policies.filter((p) => p.category === 'health');
const life = (d: PortfolioData) => d.policies.filter((p) => p.category === 'life');
/** The health policy that is tied to employment (has an "ends with employment" clause). */
const employerPlan = (d: PortfolioData) => health(d).find((p) => !!clauseWith(p, 'condition', ['employment']));

// ---------- people ----------

type Relation = 'self' | 'spouse' | 'son' | 'daughter' | 'father' | 'mother' | 'other';

interface Insured { name: string; relation: Relation; raw: string }

const SELF_WORDS = /^(self|employee|life assured|policyholder|proposer)$/i;
const RELATIONS: Relation[] = ['spouse', 'son', 'daughter', 'father', 'mother'];

/** "Suresh Mehta (father)" → { name: "Suresh Mehta", relation: "father" } */
function parseInsured(entry: string): Insured {
  const m = entry.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const name = (m?.[1] ?? entry).trim();
  const word = (m?.[2] ?? '').trim().toLowerCase();
  const relation: Relation = SELF_WORDS.test(word) ? 'self' : (RELATIONS.find((r) => r === word) ?? 'other');
  return { name, relation, raw: word };
}

const RELATION_LABEL: Record<Relation, string> = { self: 'You', spouse: 'Spouse', son: 'Son', daughter: 'Daughter', father: 'Father', mother: 'Mother', other: 'Family' };
/** How the copy refers to the person: "your father", "Meera" (spouse → name, no gendered pronoun needed). */
function refer(p: Insured): string {
  if (p.relation === 'self') return 'you';
  if (p.relation === 'spouse' || p.relation === 'other') return firstName(p.name);
  return `your ${p.relation}`;
}
/** "my father" — for prompts written the way the person would ask */
const myWord = (p: Insured) => (p.relation === 'self' ? 'me' : p.relation === 'spouse' || p.relation === 'other' ? firstName(p.name) : `my ${p.relation}`);

/** The nominee of a term policy, from its key facts or its nomination clause. */
function nomineeOf(p: Policy): { name: string; relation?: Relation; share?: string; clauseId?: string } | undefined {
  const clause = clauseWith(p, 'condition', ['nominee', 'nomination']);
  const m = clause?.text.match(/Nominee:\s*([^(.,]+?)\s*(?:\(([^)]+)\))?\s*,\s*(\d+%)?/);
  const fact = p.keyFacts.find((f) => /^nominee$/i.test(f.label))?.value.trim();
  const name = (m?.[1] ?? fact)?.trim();
  if (!name) return undefined;
  const rel = m?.[2]?.toLowerCase();
  return { name, relation: RELATIONS.find((r) => r === rel), share: m?.[3], clauseId: clause?.id };
}

/** Everyone the data names (insured lists, then nominees), self first, in a stable order. */
function people(d: PortfolioData): Insured[] {
  const seen = new Map<string, Insured>();
  for (const p of d.policies) for (const e of p.insured) {
    const x = parseInsured(e);
    const key = slug(x.name);
    if (!seen.has(key) || (seen.get(key)!.relation === 'other' && x.relation !== 'other')) seen.set(key, x);
  }
  for (const p of life(d)) {
    const n = nomineeOf(p);
    if (n && !seen.has(slug(n.name))) seen.set(slug(n.name), { name: n.name, relation: n.relation ?? 'other', raw: 'nominee' });
  }
  const order: Relation[] = ['self', 'spouse', 'son', 'daughter', 'father', 'mother', 'other'];
  return [...seen.values()].sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation));
}

const insuredOn = (p: Policy, person: Insured) => p.insured.some((e) => slug(parseInsured(e).name) === slug(person.name));

// ---------- 1. Needs attention ----------

const TONE_RANK: Record<AttentionTone, number> = { bad: 0, warn: 1, info: 2 };
const toneByDays = (days: number): AttentionTone => (days <= 30 ? 'bad' : days <= 90 ? 'warn' : 'info');
const RENEWAL_WINDOW_DAYS = 150;
const WAIT_SOON_DAYS = 60;
const LOW_COVER_SHARE = 0.25;

/** Only things that need action, most urgent first (at most 4). An empty list means "All clear". */
export function needsAttention(data: PortfolioData, today: string = DEMO_TODAY): AttentionItem[] {
  const items: (AttentionItem & { days: number })[] = [];
  const byId = (id?: string) => data.policies.find((p) => p.id === id);

  // Uploaded documents that aren't from the insurer: answers ignore them until someone checks them.
  for (const doc of data.documents.filter((x) => !x.trusted)) {
    const p = byId(doc.policyId);
    items.push({
      id: `document-${doc.id}`, tone: 'warn', days: -1,
      title: 'An uploaded note needs a look',
      detail: `${p ? `A note about ${p.name}` : 'A note you uploaded'} isn’t from the insurer, so answers don’t rely on it.`,
      action: { kind: 'documents' }, actionLabel: 'Review documents', policyId: p?.id,
    });
  }

  for (const p of data.policies) {
    // Renewal and premium due dates
    const days = daysBetween(today, p.renewalDate);
    const grace = clauseWith(p, 'condition', ['grace']);
    const graceDays = Number(grace?.text.match(/(\d+)-day grace/i)?.[1] ?? 0);
    if (days < 0 && graceDays && days >= -graceDays) {
      items.push({
        id: `renewal-${p.id}`, tone: 'bad', days,
        title: `${p.name} premium is overdue`,
        detail: `Pay by ${formatDate(addDays(p.renewalDate, graceDays))}, the end of the grace period, to keep the cover going.`,
        action: { kind: 'ask', prompt: p.category === 'life' ? 'What happens if I miss my term premium?' : 'What happens if I miss my health renewal?' },
        actionLabel: 'Ask what to do', policyId: p.id, clauseId: grace?.id, dueDate: p.renewalDate,
      });
    } else if (days >= 0 && days <= RENEWAL_WINDOW_DAYS) {
      const window = clauseWith(p, 'condition', ['add member'])?.text.match(/enrolment window in (\w+)/i)?.[1];
      const employer = p.premium === 0;
      items.push({
        id: `renewal-${p.id}`, tone: toneByDays(days), days,
        title: `${p.name} renews ${formatDate(p.renewalDate)}`,
        detail: employer
          ? window
            ? `Your employer renews it. ${window} is the only time to add parents or in-laws.`
            : 'Your employer renews it. Check with HR that your family is still enrolled.'
          : `Pay ${formatInr(p.premium)} by then${graceDays ? `, or within the ${graceDays}-day grace period,` : ''} to keep your cover going.`,
        action: { kind: 'ask', prompt: employer ? 'When can I add family to my employer health plan?' : p.category === 'life' ? 'What happens if I miss my term premium?' : 'When do I need to renew my family floater?' },
        actionLabel: employer ? 'Ask about enrolment' : 'Ask about renewal',
        policyId: p.id, clauseId: (employer ? clauseWith(p, 'condition', ['add member']) : grace)?.id, dueDate: p.renewalDate,
      });
    }

    // Portability: the application must go in well before renewal
    const port = clauseWith(p, 'condition', ['portability']);
    const before = Number(port?.text.match(/at least (\d+) days before/i)?.[1] ?? 0);
    if (port && before) {
      const deadline = addDays(p.renewalDate, -before);
      const left = daysBetween(today, deadline);
      if (left >= 0 && left <= RENEWAL_WINDOW_DAYS) {
        items.push({
          id: `portability-${p.id}`, tone: toneByDays(left), days: left,
          title: `Switching insurer? Apply by ${formatDate(deadline)}`,
          detail: `To port ${p.name}, apply at least ${before} days before it renews.`,
          action: { kind: 'ask', prompt: 'Can I port my family floater to another insurer?' },
          actionLabel: 'Ask about porting', policyId: p.id, clauseId: port.id, dueDate: deadline,
        });
      }
    }

    // Waiting periods ending soon (worth planning treatment around)
    if (p.category === 'health') for (const c of p.clauses.filter((x) => x.type === 'waiting_period')) {
      const ends = waitEnds(p, c);
      if (!ends) continue;
      const left = daysBetween(today, ends);
      if (left > 0 && left <= WAIT_SOON_DAYS) {
        items.push({
          id: `wait-${c.id}`, tone: 'info', days: left,
          title: `${c.title} wait ends ${formatDate(ends)}`,
          detail: `${p.name} covers it from ${formatDate(ends)}. Plan non-urgent treatment after that.`,
          action: { kind: 'policy', policyId: p.id }, actionLabel: 'View policy', policyId: p.id, clauseId: c.id, dueDate: ends,
        });
      }
    }

    // Low sum insured left this policy year
    if (p.category === 'health' && p.sumInsured > 0) {
      const left = p.sumInsured - sumInsuredUsed(p, data.claims);
      if (left / p.sumInsured < LOW_COVER_SHARE) {
        items.push({
          id: `cover-left-${p.id}`, tone: left <= 0 ? 'bad' : 'warn', days: daysBetween(today, p.renewalDate),
          title: `${p.name} is running low`,
          detail: `${formatInr(Math.max(0, left))} of ${formatInr(p.sumInsured)} is left till ${formatDate(p.renewalDate)}.`,
          action: { kind: 'ask', prompt: 'How much sum insured is left?' }, actionLabel: 'Ask what’s left', policyId: p.id,
        });
      }
    }
  }

  // Family members with no health cover, or whose only health cover ends with the job
  const plans = health(data);
  const employer = employerPlan(data);
  for (const person of people(data).filter((x) => x.relation !== 'self')) {
    const on = plans.filter((p) => insuredOn(p, person));
    if (!on.length) {
      items.push({
        id: `uncovered-${slug(person.name)}`, tone: 'warn', days: Number.MAX_SAFE_INTEGER - 1,
        title: `${cap(refer(person))} has no health cover`,
        detail: `${person.name} isn’t on any of your health policies.`,
        action: { kind: 'ask', prompt: `How do I add ${myWord(person)} to my health insurance?` }, actionLabel: 'Ask how to add',
      });
    } else if (on.length === 1 && on[0] === employer) {
      const ends = clauseWith(employer, 'condition', ['employment']);
      items.push({
        id: `job-only-${slug(person.name)}`, tone: 'info', days: Number.MAX_SAFE_INTEGER,
        title: `${cap(refer(person))}’s cover depends on your job`,
        detail: `Only ${employer.name} covers ${person.relation === 'spouse' ? firstName(person.name) : refer(person)}, and it ends on your last working day.`,
        action: { kind: 'ask', prompt: 'What happens to my health cover if I leave my job?' }, actionLabel: 'Ask what happens',
        policyId: employer.id, clauseId: ends?.id,
      });
    }
  }

  // In-review claims: nothing to do but wait, so they're left to the claims list.
  return items
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.days - b.days || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map(({ days: _days, ...item }) => item);
}

// ---------- 2. Coverage matrix ----------

/** Who is covered by which policy, from the insured lists, with notes such as "Life assured", "Nominee" or a co-pay. */
export function coverageMatrix(data: PortfolioData): CoverageMatrix {
  const ps = [...health(data), ...life(data)];
  const everyone = people(data);
  const cells: CoverageMatrix['cells'] = {};
  for (const person of everyone) {
    const row: Record<string, CoverageCell> = {};
    for (const p of ps) {
      const entry = p.insured.map(parseInsured).find((x) => slug(x.name) === slug(person.name));
      if (p.category === 'life') {
        const nominee = nomineeOf(p);
        if (entry) row[p.id] = { covered: true, note: 'Life assured' };
        else if (nominee && slug(nominee.name) === slug(person.name)) row[p.id] = { covered: false, note: 'Nominee' };
        else row[p.id] = { covered: false };
        continue;
      }
      if (!entry) { row[p.id] = { covered: false }; continue; }
      const copay = p.clauses.find((c) => c.type === 'deductible' && c.percent && (c.topics.includes(person.relation) || ((person.relation === 'father' || person.relation === 'mother') && c.topics.includes('parents'))));
      const note = copay ? `${copay.percent}% co-pay` : entry.raw === 'employee' ? 'Employee' : undefined;
      row[p.id] = note ? { covered: true, note } : { covered: true };
    }
    cells[slug(person.name)] = row;
  }
  return {
    people: everyone.map((x) => ({ key: slug(x.name), name: x.name, relation: RELATION_LABEL[x.relation] })),
    policies: ps.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    cells,
  };
}

// ---------- 3. Things to know ----------

type Make = (data: PortfolioData, today: string) => Insight | undefined;

/** Parents pay a share of every claim on the employer plan. */
const copayForParents: Make = (data) => {
  for (const p of health(data)) {
    const c = p.clauses.find((x) => x.type === 'deductible' && x.percent && x.topics.includes('parents'));
    if (!c) continue;
    const parent = p.insured.map(parseInsured).find((x) => x.relation === 'father' || x.relation === 'mother');
    if (!parent) continue;
    return {
      id: `copay-${c.id}`, policyId: p.id, clauseId: c.id,
      title: `${c.percent}% co-pay for your ${parent.relation}`,
      detail: `On ${p.name}, you pay ${c.percent}% of every claim for your ${parent.relation}.`,
      prompt: `Is there a co-pay for my ${parent.relation}?`,
    };
  }
};

/** Room rent limit with a fixed amount — a costlier room lowers the whole claim. */
const roomRentCap: Make = (data) => {
  for (const p of health(data)) {
    const c = p.clauses.find((x) => x.type === 'limit' && x.amount && x.topics.includes('room rent'));
    if (!c) continue;
    const proportionate = /proportionate/i.test(c.text);
    return {
      id: `room-${c.id}`, policyId: p.id, clauseId: c.id,
      title: `Room rent limit: ${formatInr(c.amount!)} a day`,
      detail: `${p.name} pays up to ${formatInr(c.amount!)} a day for the room.${proportionate ? ' A costlier room lowers the whole claim.' : ''}`,
      prompt: p === employerPlan(data) ? 'What is the room rent limit on my employer plan?' : `What is the room rent limit on ${p.name}?`,
    };
  }
};

/** Heart procedures have their own cap. */
const cardiacSubLimit: Make = (data) => {
  for (const p of health(data)) {
    const c = p.clauses.find((x) => x.type === 'limit' && x.amount && x.topics.includes('cardiac'));
    if (!c) continue;
    const what = ['angioplasty', 'bypass'].filter((w) => c.text.toLowerCase().includes(w));
    const parent = p.insured.map(parseInsured).find((x) => x.relation === 'father' || x.relation === 'mother');
    return {
      id: `cardiac-${c.id}`, policyId: p.id, clauseId: c.id,
      title: `Heart procedures capped at ${formatInrShort(c.amount!)}`,
      detail: `${p.name} pays up to ${formatInrShort(c.amount!)} a year for ${what.length ? what.join(' or ') : 'heart procedures'}.`,
      prompt: `Is angioplasty covered for ${parent ? myWord(parent) : 'me'}?`,
    };
  }
};

/** A waiting period still running on one policy (and whether another policy waives it). */
const jointReplacementWait: Make = (data, today) => {
  for (const p of health(data)) {
    const c = p.clauses.find((x) => x.type === 'waiting_period' && x.topics.includes('joint replacement'));
    const ends = c && waitEnds(p, c);
    if (!c || !ends || ends <= today) continue;
    const waiver = health(data).find((o) => o !== p && o.clauses.some((x) => x.type === 'benefit' && x.topics.includes('joint replacement') && /do not apply|waived/i.test(x.text)));
    return {
      id: `wait-${c.id}`, policyId: p.id, clauseId: c.id, relatedClauseIds: waiver ? [waiver.clauses.find((x) => x.type === 'benefit' && x.topics.includes('joint replacement'))!.id] : undefined,
      title: `Joint replacement: wait till ${monthYear(ends)}`,
      detail: `${p.name} covers knee or hip replacement from ${formatDate(ends)}.${waiver ? ` ${waiver.name} has no wait.` : ''}`,
      prompt: 'Is knee replacement covered for me?',
    };
  }
};

/** Doctor visits (OPD) aren't paid by any health policy. */
const noOpd: Make = (data) => {
  const plans = health(data);
  const hits = plans.map((p) => ({ p, c: p.clauses.find((x) => x.type === 'exclusion' && x.topics.includes('opd')) })).filter((x) => x.c);
  if (!hits.length) return undefined;
  const all = hits.length === plans.length;
  return {
    id: `opd-${hits[0].c!.id}`, policyId: hits[0].p.id, clauseId: hits[0].c!.id,
    relatedClauseIds: hits.slice(1).map((x) => x.c!.id),
    title: 'Doctor visits aren’t covered',
    detail: `${all ? (plans.length > 1 ? 'Neither health policy pays' : `${hits[0].p.name} doesn’t pay`) : `${hits[0].p.name} doesn’t pay`} for outpatient visits or glasses, only hospital care.`,
    prompt: 'Are doctor consultations covered?',
  };
};

/** Employer cover stops with the job. */
const endsWithJob: Make = (data) => {
  const p = employerPlan(data);
  const c = p && clauseWith(p, 'condition', ['employment']);
  if (!p || !c) return undefined;
  const days = c.text.match(/within (\d+) days/i)?.[1];
  return {
    id: `job-${c.id}`, policyId: p.id, clauseId: c.id,
    title: 'Employer cover ends with your job',
    detail: `${p.name} stops on your last working day.${days ? ` You may get ${days} days to convert it.` : ''}`,
    prompt: 'What happens to my health cover if I leave my job?',
  };
};

// Order = priority. The job fact comes last because "Needs attention" already raises it when a dependant relies on it.
const THINGS: Make[] = [copayForParents, roomRentCap, jointReplacementWait, noOpd, cardiacSubLimit, endsWithJob];

/** 3–5 facts people usually miss, each grounded in one clause. */
export function thingsToKnow(data: PortfolioData, today: string = DEMO_TODAY): Insight[] {
  return THINGS.map((make) => make(data, today)).filter((x): x is Insight => !!x).slice(0, 5);
}

// ---------- 4. Summary figures ----------

export function summaryFigures(data: PortfolioData, _today: string = DEMO_TODAY): SummaryFigures {
  const plans = health(data);
  return {
    healthCoverTotal: plans.reduce((s, p) => s + p.sumInsured, 0),
    healthCoverLeft: plans.reduce((s, p) => s + Math.max(0, p.sumInsured - sumInsuredUsed(p, data.claims)), 0),
    lifeCover: life(data).reduce((s, p) => s + p.sumInsured, 0),
    claimedBack: data.claims.filter((c) => c.status === 'settled').reduce((s, c) => s + (c.amountSettled ?? 0), 0),
  };
}
