// Claim-factor checks and the confidence rule.
//
// For one policy and one situation, works out each concrete thing that could change the claim outcome —
// is the person insured, is the policy active, waiting periods (computed from clause dates against
// DEMO_TODAY), pre-existing disease and disclosure, exclusions, network hospital, deadlines, co-pay,
// sub-limits, room rent and sum insured left — and gives each a status with the clause it relies on.
// Nothing here invents cover: a factor the data can't settle is `unknown`.
//
// Confidence rule (rate()):
//   Positive answers (yes / likely / partial / depends):
//     low    — any factor is a `risk` that can block the claim, or two or more factors are `unknown`
//     medium — any factor is `check` or `unknown`
//     high   — every factor is `clear` (known deductions such as a co-pay are `risk`/`reduces` and don't lower it)
//   Negative answers (no / unlikely), where a blocking factor is the reason:
//     high   — the blocker comes straight from the policy wording and nothing open could overturn it
//     medium — a `check` or `unknown` factor could still change the outcome (e.g. an accident exception)
//   Explanations (info) carry no confidence.

import type { Category, Clause, ClauseType, Confidence, ConfidenceFactor, Policy, PortfolioData, Verdict } from '../shared/types.js';
import { DEMO_TODAY } from '../shared/demo.js';
import { insuredEntry, PERSON_NOUN, type Person, type Situation, type Topic } from './situation.js';

// ---------- small helpers ----------

export const fmtDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function addPeriod(iso: string, n: number, unit: 'months' | 'days'): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First clause of the given type(s) tagged with any of the topic tags. */
export function clauseWith(p: Policy, types: ClauseType | ClauseType[], tags: string[]): Clause | undefined {
  const ts = Array.isArray(types) ? types : [types];
  return p.clauses.find((c) => ts.includes(c.type) && c.topics.some((x) => tags.includes(x)));
}

export interface WaitInfo { clause: Clause; length: number; unit: 'months' | 'days'; from: string; ends: string; served: boolean }

/** Reads "N months/days" and "from/since/started YYYY-MM-DD" from a waiting-period clause; counts from the policy start if no date is given. */
export function waitInfo(p: Policy, c: Clause): WaitInfo | undefined {
  const len = c.text.match(/(\d+)\s*(months?|days?)/i);
  if (!len) return undefined;
  const unit = /month/i.test(len[2]) ? 'months' : 'days';
  const from = c.text.match(/(?:started|since|from)\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? p.startDate;
  const ends = addPeriod(from, Number(len[1]), unit);
  return { clause: c, length: Number(len[1]), unit, from, ends, served: ends <= DEMO_TODAY };
}

const networkClause = (p: Policy) => p.clauses.find((c) => c.type === 'condition' && c.topics.includes('network'));
export function networkList(p: Policy): string[] {
  const m = networkClause(p)?.text.match(/:\s*([^.:]+)\./);
  return m ? m[1].split(/,\s*/).map((s) => s.trim()) : [];
}
const shortName = (h: string) => h.replace(/ (Multispeciality|General|Care Hospital|Hospital)$/, '');
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function hoursIn(text: string | undefined, re: RegExp): number | undefined {
  const m = text?.match(re);
  return m ? Number(m[1]) : undefined;
}

/** Sum insured used by claims dated inside the current policy year. */
export function sumInsuredUsed(p: Policy, claims: PortfolioData['claims']): { used: number; claims: PortfolioData['claims'] } {
  const inYear = claims.filter((c) => c.policyId === p.id && c.date >= p.startDate && c.date <= p.renewalDate);
  return { used: inYear.reduce((s, c) => s + (c.amountSettled ?? c.amountClaimed), 0), claims: inYear };
}

// ---------- assessment ----------

export type Outcome = 'covered' | 'not_insured' | 'excluded' | 'waiting' | 'not_mentioned' | 'lapsed';

export interface PolicyAssessment {
  policyId: string;
  policyName: string;
  category: Category;
  person: Person;
  insuredAs?: string; // the insured-list entry, e.g. "Suresh Mehta (father)"
  outcome: Outcome;
  factors: ConfidenceFactor[];
  /** Clause that grants the cover (or the exclusion / waiting clause that blocks it). */
  mainClause?: Clause;
  waitEnds?: string;
  /** A deduction that will certainly apply (e.g. co-pay, or a bill above a limit). */
  certainDeduction: boolean;
  copayPercent?: number;
  sublimit?: Clause;
  network: string[];
  inNetwork?: boolean;
  intimationHours?: number;
  preauthHours?: number;
  docsDays?: number;
  siLeft: number;
  /** An exception that could turn an exclusion into cover (e.g. dental after an accident). */
  exception?: string;
}

export interface AssessContext {
  situation: Situation;
  claims: PortfolioData['claims'];
}

const f = (id: string, label: string, status: ConfidenceFactor['status'], summary: string, clauseIds: (string | undefined)[] = [], extra: Partial<ConfidenceFactor> = {}): ConfidenceFactor => ({
  id, label, status, summary, ...extra, clauseIds: clauseIds.filter((x): x is string => !!x),
});

const DISCLOSURE_DETAIL_HEALTH = (moratoriumEnds?: string) => [
  'When you buy an individual health policy, the proposal form asks about existing conditions. If one was **not declared** and the insurer finds it at claim time (from hospital records or past prescriptions), it can:',
  '- **reject the claim** linked to that condition, and',
  '- **cancel the policy** for non-disclosure (the premium may be refunded only if there was no fraud).',
  moratoriumEnds
    ? `After **60 months of continuous cover** (here, from ${fmtDate(moratoriumEnds)}) the insurer can no longer contest claims for non-disclosure, only for proven fraud.`
    : 'After 60 months of continuous cover, claims can be contested only for proven fraud.',
  '',
  'If something wasn’t declared, tell the insurer in writing now rather than have it found at claim time. They may add a waiting period or raise the premium instead of rejecting a future claim.',
].join('\n');

/** Health: every factor that applies to this policy, person and situation. */
export function assessHealth(p: Policy, person: Person, ctx: AssessContext): PolicyAssessment {
  const s = ctx.situation;
  const topic: Topic | undefined = s.topic;
  const factors: ConfidenceFactor[] = [];
  const base: PolicyAssessment = {
    policyId: p.id, policyName: p.name, category: p.category, person, outcome: 'covered', factors,
    certainDeduction: false, network: networkList(p), siLeft: p.sumInsured,
  };
  const entry = insuredEntry(p.insured, person);
  if (!entry) {
    factors.push(f('insured', 'Who is insured', 'risk', `${cap(PERSON_NOUN[person])} ${person === 'self' ? 'aren’t' : 'isn’t'} insured under ${p.name}`, [], { impact: 'blocks', detail: `Insured under ${p.name}: ${p.insured.join(', ')}.` }));
    return { ...base, outcome: 'not_insured' };
  }
  base.insuredAs = entry;
  factors.push(f('insured', 'Who is insured', 'clear', `${entry} is insured under ${p.name}`));

  // Policy period
  if (p.status === 'lapsed' || p.renewalDate < DEMO_TODAY) {
    factors.push(f('policy-active', 'Policy active', 'risk', `Policy period ended ${fmtDate(p.renewalDate)}`, [], { impact: 'blocks' }));
    return { ...base, outcome: 'lapsed' };
  }
  const employment = clauseWith(p, 'condition', ['employment']);
  factors.push(f('policy-active', 'Policy active', 'clear', `Active till ${fmtDate(p.renewalDate)}${employment ? ' while you stay employed' : ''}`, [employment?.id]));

  const care = s.care;
  const inCare = care === 'admitted' || care === 'incident' || care === 'emergency_now';
  const claimish = inCare || care === 'planned' || care === 'discharged' || s.payCash || s.wantsCost || !!s.bill;

  // ---- what the topic is: excluded items and named benefits ----
  if (topic?.kind === 'excluded') {
    const ex = clauseWith(p, 'exclusion', topic.exclusion ?? []);
    if (!ex) {
      factors.push(f('benefit', 'Cover for this', 'unknown', `${p.name} doesn’t mention ${topic.label}`));
      return { ...base, outcome: 'not_mentioned' };
    }
    const accidentException = /unless|except/i.test(ex.text) && /accident/i.test(ex.text);
    if (accidentException && s.accident) {
      factors.push(f('exclusion', 'Exclusion', 'check', 'Excluded unless an accident needs a hospital stay, which may apply here', [ex.id], { detail: ex.text }));
      base.mainClause = ex;
      base.exception = 'accident';
    } else {
      factors.push(f('exclusion', 'Exclusion', 'risk', `${cap(topic.label)} ${/s$/.test(topic.label) ? 'are' : 'is'} excluded${accidentException ? ' unless an accident needs a hospital stay' : ''} (${ex.section})`, [ex.id], { impact: 'blocks', detail: ex.text }));
      return { ...base, outcome: 'excluded', mainClause: ex, exception: accidentException ? 'accident' : undefined };
    }
  }
  if (topic?.kind === 'benefit') {
    const b = clauseWith(p, 'benefit', topic.benefit ?? []);
    if (!b) {
      factors.push(f('benefit', 'Cover for this', 'unknown', `${p.name} doesn’t mention ${topic.label}`));
      return { ...base, outcome: 'not_mentioned' };
    }
    factors.push(f('benefit', 'Cover for this', 'clear', `${b.title}: ${b.amount ? `up to ${inr(b.amount)}` : 'covered'} (${b.section})`, [b.id], { detail: b.text }));
    factors.push(f('needs-admission', 'Linked to an admission', 'check', 'Paid only alongside a covered hospital stay', [clauseWith(p, 'benefit', ['hospitalisation'])?.id]));
    return { ...base, mainClause: b };
  }

  // ---- the benefit itself ----
  let main: Clause | undefined;
  if (topic?.kind === 'maternity') {
    main = clauseWith(p, 'benefit', ['maternity']);
    const wait = clauseWith(p, 'waiting_period', ['maternity']);
    if (!main && wait) {
      const w = waitInfo(p, wait);
      if (w && !w.served) {
        factors.push(f('waiting-period', 'Maternity waiting period', 'risk', `${w.length}-month maternity wait runs till ${fmtDate(w.ends)}`, [wait.id], { impact: 'blocks', detail: `${wait.text}\n\nCounted from ${fmtDate(w.from)}. A delivery before ${fmtDate(w.ends)} isn’t covered by ${p.name}.` }));
        return { ...base, outcome: 'waiting', mainClause: wait, waitEnds: w.ends };
      }
      main = wait;
      if (w) factors.push(f('waiting-period', 'Maternity waiting period', 'clear', `${w.length}-month wait ended on ${fmtDate(w.ends)}`, [wait.id]));
    } else if (main) {
      factors.push(f('waiting-period', 'Maternity waiting period', 'clear', 'No waiting period: covered from day one', [main.id, clauseWith(p, 'benefit', ['initial waiting'])?.id]));
    }
    if (!main) {
      factors.push(f('benefit', 'Maternity cover', 'unknown', `${p.name} doesn’t mention maternity`));
      return { ...base, outcome: 'not_mentioned' };
    }
    if (main.amount) {
      factors.push(f('sub-limit', 'Maternity limit', 'risk', `Up to ${inr(main.amount)} per delivery`, [main.id], { impact: 'reduces', detail: 'Delivery bills above this limit are yours to pay, whether normal or caesarean.' }));
      base.sublimit = main;
      if (s.bill && s.bill > main.amount) base.certainDeduction = true;
    }
  } else {
    const hosp = clauseWith(p, 'benefit', ['hospitalisation']);
    if (topic?.benefit) {
      main = clauseWith(p, 'benefit', topic.benefit);
      if (!main) {
        factors.push(f('benefit', `Cover for ${topic.label}`, 'unknown', `${p.name} doesn’t mention ${topic.label}, though its general hospitalisation cover may apply`, [hosp?.id], { detail: `Only the in-patient hospitalisation clause could apply:\n\n> ${hosp?.text ?? 'no hospitalisation clause found'}\n\nAsk ${p.claimContact ?? 'the insurer'} whether ${topic.label} is treated as a covered illness.` }));
        return { ...base, outcome: 'not_mentioned', mainClause: hosp };
      }
    } else main = hosp;
    if (!main) {
      factors.push(f('benefit', 'Cover for this', 'unknown', `${p.name} has no hospitalisation clause`));
      return { ...base, outcome: 'not_mentioned' };
    }
    if (topic?.dayCare && clauseWith(p, 'benefit', ['day care'])) {
      const dc = clauseWith(p, 'benefit', ['day care'])!;
      factors.push(f('benefit', 'Cover for this', 'clear', `Covered as day care, so no 24-hour stay is needed (${dc.section})`, [dc.id], { detail: dc.text }));
      main = dc;
    } else {
      factors.push(f('benefit', 'Cover for this', 'clear', `${main.title} (${main.section})${topic && topic.id !== 'accident' ? ` includes ${topic.label} in hospital` : ''}`, [main.id], { detail: main.text }));
    }
    if (topic?.kind === 'chronic' || (s.preExisting && !inCare && care !== 'planned')) {
      const opd = clauseWith(p, 'exclusion', ['opd']);
      factors.push(f('needs-admission', 'Needs a hospital stay', 'check', 'Paid only for a hospital stay (24 hours or more) or day care, not routine medicines or doctor visits', [main.id, opd?.id], { detail: `Long-term conditions like ${topic?.label ?? 'this'} are usually managed with medicines and check-ups, which a hospitalisation policy doesn’t pay for${opd ? ` (${opd.title}, ${opd.section})` : ''}. A claim is paid when the condition or a complication needs admission.` }));
    }

    // ---- waiting periods ----
    const groupWaiver = clauseWith(p, 'benefit', ['waiting period', 'initial waiting']);
    if (s.accident && topic?.id !== 'maternity') {
      factors.push(f('waiting-period', 'Waiting period', 'clear', 'Accidents have no waiting period', [clauseWith(p, 'waiting_period', ['new policy'])?.id ?? groupWaiver?.id]));
    } else if (groupWaiver) {
      factors.push(f('waiting-period', 'Waiting period', 'clear', 'All waiting periods are waived (group policy)', [groupWaiver.id]));
    } else {
      const specific = topic?.wait ? clauseWith(p, 'waiting_period', topic.wait) : undefined;
      const initial = clauseWith(p, 'waiting_period', ['new policy']);
      const w = specific ? waitInfo(p, specific) : initial ? waitInfo(p, initial) : undefined;
      if (w) {
        const what = specific ? `${w.length}-month wait for ${topic!.label}` : `${w.length}-day initial wait`;
        if (w.served) factors.push(f('waiting-period', 'Waiting period', 'clear', `${cap(what)} ended on ${fmtDate(w.ends)}`, [w.clause.id], { detail: w.clause.text }));
        else {
          factors.push(f('waiting-period', 'Waiting period', 'risk', `${cap(what)} runs till ${fmtDate(w.ends)}`, [w.clause.id], { impact: 'blocks', detail: `${w.clause.text}\n\nCounted from ${fmtDate(w.from)}, so ${p.name} doesn’t cover treatment before ${fmtDate(w.ends)}${/accident/i.test(w.clause.text) ? ', unless it’s needed because of an accident' : ''}.` }));
          base.outcome = 'waiting';
          base.waitEnds = w.ends;
          base.mainClause = w.clause;
        }
      }
    }

    // ---- pre-existing disease and disclosure ----
    const pedRelevant = s.preExisting || topic?.kind === 'chronic' || !!topic?.oftenPreExisting;
    if (pedRelevant) {
      const pedBenefit = clauseWith(p, 'benefit', ['pre-existing']);
      const pedWait = clauseWith(p, 'waiting_period', ['pre-existing']);
      const ifPed = s.preExisting || topic?.kind === 'chronic' ? '' : 'If it’s pre-existing: ';
      if (pedBenefit) factors.push(f('pre-existing', 'Pre-existing condition', 'clear', `${ifPed}${ifPed ? 'c' : 'C'}overed from day one`, [pedBenefit.id], { detail: pedBenefit.text }));
      else if (pedWait) {
        const w = waitInfo(p, pedWait);
        if (w?.served) factors.push(f('pre-existing', 'Pre-existing condition', 'clear', `${ifPed}${w.length}-month wait ended on ${fmtDate(w.ends)} (if it was declared)`, [pedWait.id], { detail: pedWait.text }));
        else if (w) {
          factors.push(f('pre-existing', 'Pre-existing condition', ifPed ? 'check' : 'risk', `${ifPed}${w.length}-month wait runs till ${fmtDate(w.ends)}`, [pedWait.id], { impact: ifPed ? undefined : 'blocks', detail: pedWait.text }));
          if (!ifPed) { base.outcome = 'waiting'; base.waitEnds = w.ends; base.mainClause = pedWait; }
        }
      }
      const groupDisclosure = clauseWith(p, 'condition', ['underwriting']);
      const disclosure = clauseWith(p, 'condition', ['disclosure']);
      if (groupDisclosure) factors.push(f('disclosure', 'Disclosure', 'clear', 'Group cover asks no health questions, so nothing had to be declared', [groupDisclosure.id], { detail: groupDisclosure.text }));
      else if (disclosure) {
        const mor = disclosure.text.match(/(\d+) months of continuous coverage, counted from (\d{4}-\d{2}-\d{2})/);
        const morEnds = mor ? addPeriod(mor[2], Number(mor[1]), 'months') : undefined;
        const openWindow = !morEnds || morEnds > DEMO_TODAY;
        const notDeclared = /\b(didn'?t|did not|never|not) (declare|disclose|tell|mention|inform)|\bhid\b|\bhidden\b|undisclosed|without (declaring|disclosing|telling)/i.test(s.raw);
        if (notDeclared && openWindow) {
          factors.push(f('disclosure', 'Disclosure', 'risk', `Not declared when you bought it, so the claim can be rejected and the policy cancelled${morEnds ? ` (the insurer can raise this until ${fmtDate(morEnds)})` : ''}`, [disclosure.id], { impact: 'blocks', detail: DISCLOSURE_DETAIL_HEALTH(morEnds) }));
          if (base.outcome === 'covered') base.outcome = 'excluded';
        } else if (openWindow) {
          factors.push(f('disclosure', 'Disclosure', 'check', `Was it declared when you bought the policy? If not, the claim can be rejected${morEnds ? ` (the insurer can check until ${fmtDate(morEnds)})` : ''}`, [disclosure.id], { detail: DISCLOSURE_DETAIL_HEALTH(morEnds) }));
        } else {
          factors.push(f('disclosure', 'Disclosure', 'clear', `Past 60 months of continuous cover (${fmtDate(morEnds!)}), so only proven fraud can be raised`, [disclosure.id], { detail: disclosure.text }));
        }
      }
    }

    // ---- limits on what is paid ----
    if (topic?.sublimit) {
      const lim = clauseWith(p, 'limit', topic.sublimit);
      if (lim?.amount) {
        base.sublimit = lim;
        const over = !!s.bill && s.bill > lim.amount;
        if (over) base.certainDeduction = true;
        factors.push(f('sub-limit', 'Sub-limit', 'risk', `${lim.title}: ${lim.text.replace(/\.$/, '').replace(/^.*?(limited to|capped at)\s*/i, 'up to ')}`, [lim.id], { impact: 'reduces', detail: `${lim.text}${over ? `\n\nYour ${inr(s.bill!)} bill is above this, so you’d pay at least ${inr(s.bill! - lim.amount)}.` : ''}` }));
      }
    }
  }

  const copay = p.clauses.find((c) => c.type === 'deductible' && c.percent && /parent/i.test(c.text));
  if (copay && (person === 'father' || person === 'mother')) {
    base.copayPercent = copay.percent;
    base.certainDeduction = true;
    factors.push(f('co-pay', 'Co-pay', 'risk', `You pay ${copay.percent}% of every claim for parents`, [copay.id], { impact: 'reduces', detail: `${copay.text}\n\nExample: on ₹1,00,000 of approved charges the insurer pays ₹${(100000 * (100 - copay.percent!) / 100).toLocaleString('en-IN')} and you pay ₹${(100000 * copay.percent! / 100).toLocaleString('en-IN')}.` }));
  }

  // ---- how the claim is made: network, deadlines ----
  const cashless = clauseWith(p, 'benefit', ['cashless']);
  const claimProc = p.clauses.find((c) => c.type === 'claim_process');
  const deadlines = clauseWith(p, 'condition', ['intimation']);
  base.intimationHours = hoursIn(cashless?.text, /within (\d+) hours/i) ?? hoursIn(deadlines?.text, /within (\d+) hours/i);
  base.preauthHours = hoursIn(deadlines?.text, /(\d+) hours before/i) ?? hoursIn(cashless?.text, /(\d+) hours before/i);
  base.docsDays = hoursIn(claimProc?.text, /within (\d+) days of discharge/i);
  const netClause = networkClause(p);
  const list = base.network.map(shortName).join(', ');
  const paidAlready = care === 'discharged' || (s.payCash && !inCare);
  if (claimish || s.wantsCashless || s.hospital || s.nonNetworkHospital) {
    if (paidAlready) {
      factors.push(f('network', 'Network hospital', 'clear', 'Reimbursement works at any registered hospital, in the network or not', [netClause?.id]));
    } else if (s.hospital) {
      const hit = base.network.find((h) => h.toLowerCase().includes(s.hospital!));
      base.inNetwork = !!hit;
      factors.push(hit
        ? f('network', 'Network hospital', 'clear', `${shortName(hit)} is a network hospital, so cashless is available`, [netClause?.id, cashless?.id])
        : f('network', 'Network hospital', 'check', `${cap(s.hospital)} isn’t a network hospital, so pay the bill and claim reimbursement`, [netClause?.id], { detail: `Cashless hospitals for ${p.name}: ${list}.` }));
    } else if (s.nonNetworkHospital) {
      base.inNetwork = false;
      factors.push(f('network', 'Network hospital', 'check', `At a non-network hospital, pay the bill and claim reimbursement${base.docsDays ? ` within ${base.docsDays} days` : ''}`, [netClause?.id, claimProc?.id], { detail: `Treatment is still covered. Only the way you pay changes. Cashless hospitals for ${p.name}: ${list}.` }));
    } else {
      factors.push(f('network', 'Network hospital', 'check', `Cashless only at ${andList(base.network.map(shortName))}. Elsewhere, pay and claim reimbursement`, [netClause?.id, cashless?.id]));
    }
  }
  if (inCare && base.intimationHours) {
    factors.push(f('intimation', 'Tell the insurer', 'check', `Tell the ${/TPA/.test(cashless?.text ?? '') ? 'claims desk (TPA)' : 'insurer'} within ${base.intimationHours} hours of admission`, [cashless?.id, deadlines?.id], { detail: `${cashless?.text ?? ''}${deadlines && /condoned|accepted/i.test(deadlines.text) ? `\n\nMissed it? Tell them as soon as you can and explain the delay in writing. ${deadlines.section} accepts justified delays.` : ''}` }));
  } else if (care === 'planned' && base.preauthHours) {
    factors.push(f('intimation', 'Pre-authorisation', 'check', `Ask for cashless approval (pre-authorisation) at least ${base.preauthHours} hours before admission`, [deadlines?.id ?? cashless?.id], { detail: deadlines?.text ?? cashless?.text }));
  }
  if ((paidAlready || s.payCash || s.nonNetworkHospital || base.inNetwork === false) && base.docsDays) {
    factors.push(f('documents-deadline', 'Claim deadline', 'check', `Submit the reimbursement claim within ${base.docsDays} days of discharge`, [claimProc?.id, deadlines?.id], { detail: `${claimProc?.text ?? ''}${deadlines && /condoned|accepted/i.test(deadlines.text) ? `\n\nLate? Submit anyway with a written reason. ${deadlines.section} accepts justified delays.` : ''}` }));
  }

  // ---- room rent, non-medical items, sum insured ----
  if (claimish) {
    const room = clauseWith(p, 'limit', ['room rent']);
    if (room) factors.push(f('room-rent', 'Room rent', 'check', room.amount ? `Room rent limit ${inr(room.amount)} a day. A costlier room reduces the whole claim` : 'Room rent limit: a single private room. A higher category reduces the whole claim', [room.id], { detail: roomRentDetail(room) }));
    const nonMed = clauseWith(p, 'exclusion', ['non-medical']);
    if (nonMed && (inCare || care === 'discharged' || s.wantsCost || !!s.bill)) factors.push(f('non-medical', 'Non-medical items', 'risk', 'Gloves, admission kits, toiletries and attendant charges aren’t paid', [nonMed.id], { impact: 'reduces', detail: nonMed.text }));
    const used = sumInsuredUsed(p, ctx.claims);
    base.siLeft = p.sumInsured - used.used;
    const shared = p.insured.length > 1 ? ', shared by the family' : '';
    if (s.bill && s.bill > base.siLeft) {
      base.certainDeduction = true;
      factors.push(f('sum-insured', 'Sum insured left', 'risk', `Only ${inr(base.siLeft)} left this year, less than the ${inr(s.bill)} bill`, [], { impact: 'reduces' }));
    } else {
      factors.push(f('sum-insured', 'Sum insured left', 'clear', used.used ? `${inr(base.siLeft)} of ${inr(p.sumInsured)} left this year${shared} (after ${inr(used.used)} already claimed)` : `Full ${inr(p.sumInsured)} available this year${shared}`));
    }
  }
  if (!base.mainClause) base.mainClause = main;
  return base;
}

function roomRentDetail(room: Clause): string {
  const cap = room.amount;
  return [
    room.text,
    '',
    cap
      ? `**How the deduction works:** pick a ₹${(cap * 2).toLocaleString('en-IN')}-a-day room against a ${inr(cap)} limit and the insurer pays only half (${inr(cap)} of ${inr(cap * 2)}) of most other charges too, such as doctor fees, procedures and nursing. Medicines and implants are usually paid in full.`
      : '**How the deduction works:** choose a room above your eligible category and most other charges, such as doctor fees, procedures and nursing, are paid in the same proportion as the room rent, not just the room difference.',
  ].join('\n');
}

// ---------- term life ----------

export interface LifeContext {
  raw: string;
  suicide: boolean;
  abroad: boolean;
  accident: boolean;
  notDisclosed: boolean;
  disclosureTopic: boolean;
  missedPremium: boolean;
  intoxication: boolean;
}

export interface LifeAssessment {
  policyId: string;
  policyName: string;
  factors: ConfidenceFactor[];
  outcome: 'covered' | 'reduced' | 'not_covered';
  payout: number;
  riderAmount?: number;
  nominee?: string;
  premiumDue: string;
  graceEnds: string;
  contestableTill: string;
  suicideTill: string;
}

export function assessLife(p: Policy, c: LifeContext): LifeAssessment {
  const factors: ConfidenceFactor[] = [];
  const death = clauseWith(p, 'benefit', ['death']);
  const rider = clauseWith(p, 'benefit', ['accidental death']);
  const suicide = clauseWith(p, 'exclusion', ['suicide']);
  const sec45 = clauseWith(p, 'condition', ['section 45']);
  const grace = clauseWith(p, 'condition', ['grace']);
  const revival = clauseWith(p, 'condition', ['revival']);
  const nomination = clauseWith(p, 'condition', ['nominee']);
  const worldwide = clauseWith(p, 'benefit', ['worldwide']);
  const riderEx = clauseWith(p, 'exclusion', ['rider exclusion']);
  const nominee = nomination?.text.match(/Nominee:\s*([^,(.]+)/)?.[1].trim() ?? p.keyFacts.find((k) => /nominee/i.test(k.label))?.value;
  const graceDays = hoursIn(grace?.text, /(\d+)-day grace/i) ?? 30;
  const graceEnds = addPeriod(p.renewalDate, graceDays, 'days');
  const contestYears = hoursIn(sec45?.text, /within (\d+) years/i) ?? 3;
  const contestableTill = addPeriod(p.startDate, contestYears * 12, 'months');
  const suicideMonths = hoursIn(suicide?.text, /within (\d+) months/i) ?? 12;
  const suicideTill = addPeriod(p.startDate, suicideMonths, 'months');
  let outcome: LifeAssessment['outcome'] = 'covered';

  factors.push(f('insured', 'Life assured', 'clear', `${p.insured[0]}, cover ${inr(p.sumInsured)}`, [death?.id]));
  // Premium / in force
  if (c.missedPremium) {
    factors.push(f('policy-active', 'Premium paid', 'check', `If a premium is missed, cover continues through the ${graceDays}-day grace period, then lapses`, [grace?.id, revival?.id], { detail: `${grace?.text ?? ''}\n\n${revival?.text ?? ''}` }));
  } else {
    factors.push(f('policy-active', 'Premium paid', 'clear', `In force. Next premium due ${fmtDate(p.renewalDate)}, grace till ${fmtDate(graceEnds)}`, [grace?.id]));
  }
  factors.push(nominee
    ? f('nominee', 'Nominee', 'clear', `${nominee} is the registered nominee`, [nomination?.id], { detail: nomination?.text })
    : f('nominee', 'Nominee', 'unknown', 'No nominee recorded, so legal heirs would need a succession certificate'));
  // Section 45
  if (sec45) {
    const past = contestableTill <= DEMO_TODAY;
    if (c.notDisclosed && !past) {
      factors.push(f('disclosure', 'Disclosure (Section 45)', 'risk', `Until ${fmtDate(contestableTill)}, a misstatement can lead to rejection`, [sec45.id], { impact: 'blocks', detail: SECTION_45_DETAIL(contestableTill, past) }));
      outcome = 'not_covered';
    } else {
      factors.push(f('disclosure', 'Disclosure (Section 45)', past ? 'clear' : 'check', past ? `The 3-year window ended on ${fmtDate(contestableTill)}, so the policy can’t be questioned on any ground` : `Until ${fmtDate(contestableTill)}, a claim can be investigated for misstatements`, [sec45.id], { detail: SECTION_45_DETAIL(contestableTill, past) }));
    }
  }
  if (c.suicide && suicide) {
    const within = suicideTill > DEMO_TODAY;
    factors.push(f('suicide', 'Suicide clause', within ? 'risk' : 'clear', within ? `Until ${fmtDate(suicideTill)}, only 80% of premiums paid are refunded` : `The ${suicideMonths}-month clause ended on ${fmtDate(suicideTill)}, so the full cover is payable`, [suicide.id, revival?.id], { impact: within ? 'blocks' : undefined, detail: `${suicide.text}\n\nA revival after a lapse restarts this 12-month period.` }));
    if (within) outcome = 'not_covered';
  }
  if (c.abroad) {
    factors.push(worldwide
      ? f('abroad', 'Death abroad', 'clear', 'Covered worldwide. The death certificate needs Indian embassy attestation', [worldwide.id], { detail: worldwide.text })
      : f('abroad', 'Death abroad', 'unknown', 'The policy doesn’t say where death must occur'));
  }
  let riderAmount: number | undefined;
  if (c.accident && rider) {
    riderAmount = rider.amount;
    factors.push(f('rider', 'Accidental death rider', 'clear', `Extra ${inr(rider.amount ?? 0)} if death follows within 180 days of the accident`, [rider.id], { detail: rider.text }));
    if (riderEx) factors.push(f('rider-exclusions', 'Rider exclusions', c.intoxication ? 'risk' : 'check', c.intoxication ? 'The rider isn’t paid if intoxication was involved. The base cover still is' : 'The rider isn’t paid for intoxication, self-harm, hazardous sports, crime or war', [riderEx.id], { impact: c.intoxication ? 'reduces' : undefined, detail: riderEx.text }));
    if (c.intoxication) { riderAmount = undefined; if (outcome === 'covered') outcome = 'reduced'; }
  }
  return {
    policyId: p.id, policyName: p.name, factors, outcome, payout: death?.amount ?? p.sumInsured, riderAmount, nominee,
    premiumDue: p.renewalDate, graceEnds, contestableTill, suicideTill,
  };
}

const SECTION_45_DETAIL = (till: string, past: boolean) => [
  'Under **Section 45 of the Insurance Act, 1938**, a life insurer can question a policy for **fraud or misstatement of a material fact** (for example smoking, an illness or income) only within **3 years** of the policy being issued or revived.',
  `- Within 3 years: the insurer can investigate and reject the claim if it proves the misstatement was material.`,
  `- After 3 years: the policy **can’t be called in question on any ground**, and the claim is paid.`,
  '',
  past
    ? `For this policy the 3 years ended on ${fmtDate(till)}. A revival after a lapse would restart the 3 years.`
    : `For this policy the 3 years run till ${fmtDate(till)}.`,
].join('\n');

// ---------- confidence ----------

const POSITIVE: Verdict[] = ['yes', 'likely', 'partial', 'depends'];

export function rate(verdict: Verdict, factors: ConfidenceFactor[]): Confidence {
  const blockers = factors.filter((x) => x.status === 'risk' && x.impact !== 'reduces');
  const checks = factors.filter((x) => x.status === 'check');
  const unknowns = factors.filter((x) => x.status === 'unknown');
  const open = checks.length + unknowns.length;
  // The level is the label; the reason names the one thing that matters most (the factor list has the rest)
  const sentence = (x: ConfidenceFactor) => `${cap(x.summary)}.`;
  if (POSITIVE.includes(verdict)) {
    if (blockers.length || unknowns.length >= 2) {
      return { level: 'low', label: 'Low confidence', reason: blockers.length ? sentence(blockers[0]) : 'The policy wording doesn’t settle several deciding points.', factors };
    }
    if (open) return { level: 'medium', label: 'Medium confidence', reason: sentence(checks[0] ?? unknowns[0]), factors };
    return { level: 'high', label: 'High confidence', reason: 'Every check passes on the policy wording. The insurer still makes the final decision.', factors };
  }
  if (open) return { level: 'medium', label: 'Medium confidence', reason: sentence(checks[0] ?? unknowns[0]), factors };
  return { level: 'high', label: 'High confidence', reason: blockers[0] ? `${sentence(blockers[0])} This is stated in the policy wording.` : 'This is stated in the policy wording.', factors };
}

/** Orders factors: blocking risks, checks, unknowns, deductions, then clear. */
export function orderFactors(fs: ConfidenceFactor[]): ConfidenceFactor[] {
  const rank = (x: ConfidenceFactor) => (x.status === 'risk' && x.impact !== 'reduces' ? 0 : x.status === 'check' ? 1 : x.status === 'unknown' ? 2 : x.status === 'risk' ? 3 : 4);
  return fs.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((y) => y.x);
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
