// Reads a message into a structured situation: who is affected, what is happening (care state), the
// medical topic, how the bill is being paid, which hospital, and the bill amount.
//
// Pure, rule-based text matching — no model and no randomness. The engine (server/agent.ts) routes on
// this, and the claim-factor checks (server/confidence.ts) use it to decide which factors apply.

export type Person = 'self' | 'spouse' | 'son' | 'daughter' | 'father' | 'mother' | 'sibling' | 'grandparent' | 'inlaw' | 'other';

/**
 * - emergency_now: something acute is happening and the person is not yet in care ("chest pain right now")
 * - admitted:      already in hospital / ICU / just had surgery
 * - incident:      something happened (injury, fall, "had a heart attack"), admission not stated
 * - discharged:    back home after a stay, or the bill was already paid
 * - planned:       a planned or advised procedure
 * - none:          a coverage question with nothing happening
 */
export type CareState = 'emergency_now' | 'admitted' | 'incident' | 'discharged' | 'planned' | 'none';

export type TopicKind =
  | 'treatment' // an in-patient treatment or illness
  | 'chronic' // a long-term condition that is usually pre-existing
  | 'maternity'
  | 'excluded' // OPD, dental, cosmetic, spectacles: excluded unless an exception applies
  | 'benefit'; // a named benefit such as ambulance or pre/post hospitalisation

export interface Topic {
  id: string;
  label: string; // used in sentences: "cover for {label}"
  kind: TopicKind;
  re: RegExp;
  /** Clause topic tags that identify the benefit clause(s) for this topic. Falls back to in-patient hospitalisation. */
  benefit?: string[];
  /** Clause topic tags of an exclusion that applies to this topic. */
  exclusion?: string[];
  /** Clause topic tags of a specific waiting period. */
  wait?: string[];
  /** Clause topic tags of a sub-limit. */
  sublimit?: string[];
  /** Often a pre-existing condition (heart disease, cancer): the pre-existing wait and disclosure checks apply. */
  oftenPreExisting?: boolean;
  /** Usually a day-care procedure (no 24-hour stay needed). */
  dayCare?: boolean;
  /** The underlying condition, for disclosure wording ("a heart condition"). Defaults to the label. */
  cond?: string;
}

// Order matters: the first match wins, so specific topics come before general ones.
export const TOPICS: Topic[] = [
  { id: 'maternity', label: 'maternity and delivery', kind: 'maternity', re: /\b(maternity|pregnan\w*|deliver(y|ies)|childbirth|c-?section|caesarean|expecting( a)? baby|having a baby|giving birth)\b/, benefit: ['maternity'], wait: ['maternity'] },
  { id: 'cataract', label: 'cataract surgery', kind: 'treatment', re: /\b(cataract|catract|lens implant)\b/, benefit: ['cataract', 'day care'], wait: ['cataract'], sublimit: ['cataract'], dayCare: true },
  { id: 'joint', label: 'joint replacement', kind: 'treatment', re: /\b((knee|hip|joint) (replacement|surgery|transplant)|replace(ment of)? (his|her|my|the) (knee|hip)|knee|osteoarthritis|arthritis)\b/, wait: ['joint replacement'] },
  { id: 'hernia', label: 'hernia surgery', kind: 'treatment', re: /\bhernia\b/, wait: ['hernia'] },
  { id: 'stones', label: 'stone removal', kind: 'treatment', re: /\b(kidney stones?|gall ?(bladder|stones?)|stones?)\b/, wait: ['kidney stones', 'gallbladder'] },
  { id: 'piles', label: 'piles or fistula surgery', kind: 'treatment', re: /\b(piles|haemorrhoids|hemorrhoids|fistula|fissure)\b/, wait: ['piles'] },
  { id: 'sinus', label: 'sinus or tonsil surgery', kind: 'treatment', re: /\b(sinus\w*|tonsil\w*|deviated septum)\b/, wait: ['sinus'] },
  { id: 'cardiac', label: 'heart treatment', kind: 'treatment', re: /\b(heart|cardiac|chest pain|angioplasty|bypass|stent|angina|cardio\w*)\b/, sublimit: ['cardiac'], oftenPreExisting: true, cond: 'a heart condition' },
  { id: 'cancer', label: 'cancer treatment', kind: 'treatment', re: /\b(cancer|tumou?r|chemo\w*|radiotherapy|oncolog\w*|leukemia|leukaemia)\b/, benefit: ['hospitalisation'], oftenPreExisting: true, cond: 'cancer' },
  { id: 'dialysis', label: 'dialysis', kind: 'treatment', re: /\bdialysis\b/, benefit: ['dialysis', 'day care'], oftenPreExisting: true, dayCare: true, cond: 'kidney disease' },
  { id: 'mental', label: 'mental health treatment', kind: 'treatment', re: /\b(mental (health|illness)|psychiatr\w*|depression|anxiety|bipolar|schizophrenia|therapy|counsell?ing)\b/, benefit: ['mental illness'] },
  { id: 'diabetes', label: 'diabetes', kind: 'chronic', re: /\b(diabet\w*|sugar (problem|patient)|blood sugar|insulin)\b/ },
  { id: 'hypertension', label: 'high blood pressure', kind: 'chronic', re: /\b(hypertension|high (blood )?pressure|\bbp\b|blood pressure)\b/ },
  { id: 'thyroid', label: 'thyroid', kind: 'chronic', re: /\b(thyroid|hypothyroid\w*|hyperthyroid\w*)\b/, cond: 'a thyroid condition' },
  { id: 'asthma', label: 'asthma', kind: 'chronic', re: /\b(asthma|asthmatic|copd)\b/ },
  { id: 'dengue', label: 'dengue or other fever', kind: 'treatment', re: /\b(dengue|malaria|typhoid|chikungunya|fever|viral|infection|pneumonia|covid)\b/ },
  { id: 'appendix', label: 'appendix surgery', kind: 'treatment', re: /\b(appendix|appendicitis|appendectomy)\b/ },
  { id: 'dental', label: 'dental treatment', kind: 'excluded', re: /\b(dental|dentist|teeth|tooth|root canal|braces|wisdom tooth)\b/, exclusion: ['dental'] },
  { id: 'cosmetic', label: 'cosmetic treatment', kind: 'excluded', re: /\b(cosmetic|plastic surgery|hair transplant|botox|liposuction|nose job|rhinoplasty)\b/, exclusion: ['cosmetic'] },
  { id: 'spectacles', label: 'spectacles and lenses', kind: 'excluded', re: /\b(spectacles|glasses|contact lens\w*)\b/, exclusion: ['spectacles'] },
  { id: 'opd', label: 'outpatient (OPD) consultations', kind: 'excluded', re: /\b(opd|out-?patient|consultations?|doctor('s)? (visit|fees?)|clinic visit|check-?ups?|health check)\b/, exclusion: ['opd'] },
  { id: 'accident', label: 'accident treatment', kind: 'treatment', re: /\b(accident|injur\w*|fractur\w*|broke|broken|fell|fall|hurt|bleeding|burns?)\b/ },
  { id: 'daycare', label: 'day care procedures', kind: 'treatment', re: /\b(day ?care|same day|short stay|less than 24 hours)\b/, benefit: ['day care'], dayCare: true },
  { id: 'ambulance', label: 'ambulance charges', kind: 'benefit', re: /\bambulance\b/, benefit: ['ambulance'] },
  { id: 'prepost', label: 'pre- and post-hospitalisation costs', kind: 'benefit', re: /\b(pre[- ]?(and )?post|pre[- ]hospitali[sz]ation|post[- ]hospitali[sz]ation|after discharge|follow[- ]?ups?|before admission)\b/, benefit: ['pre hospitalisation'] },
];

/** Chronic or pre-existing wording. */
const PRE_EXISTING = /\b(pre-?existing|existing (condition|disease|illness)|already (have|has|had|diagnosed)|since (\d+ )?years|for years|history of|chronic|diagnosed (with|before)|long-?term)\b/;

export type Gender = 'm' | 'f' | 'n' | 'pl';
export interface PersonName { noun: string; g: Gender }

export interface Situation {
  raw: string; // the message, lower case
  /** How the message refers to each person ("your wife", "Kabir", "your brother"). */
  names: Partial<Record<Person, PersonName>>;
  persons: Person[]; // in order of mention, deduplicated
  person?: Person; // the main person
  care: CareState;
  topic?: Topic;
  /** The condition is (or may be) pre-existing. */
  preExisting: boolean;
  /** Paying cash / claiming reimbursement rather than cashless. */
  payCash: boolean;
  wantsCashless: boolean;
  hospital?: string; // a named hospital, lower case ("riverside")
  nonNetworkHospital: boolean; // "a non-network hospital", "hospital not on the list"
  bill?: number;
  wantsCost: boolean;
  accident: boolean;
}

const PERSON_CUES: [Person, RegExp][] = [
  ['inlaw', /\b(mother|father|parents?)[- ]in[- ]laws?|in-?laws|saas|sasur\b/],
  ['grandparent', /\b(grand(father|mother|ma|pa|parents?)|dadi|nani|dada|nana)\b/],
  ['father', /\b(father|fater|farther|fathr|dad|daddy|papa|pitaji|suresh)\b/],
  ['mother', /\b(mother|mom|mum|mummy|mommy|maa|mata ?ji|amma)\b/],
  ['spouse', /\b(wife|husband|spouse|meera|partner|patni|pati)\b/],
  ['son', /\b(son|kabir|beta)\b/],
  ['daughter', /\b(daughter|beti)\b/],
  ['sibling', /\b(brother|sister|bhai|didi|sibling)\b/],
  ['other', /\b(friend|cousin|uncle|aunt|aunty|nephew|niece|colleague|neighbou?r|maid|driver)\b/],
];
const SELF = /\b(i|i'm|im|i've|me|myself|my ?self|aarav|mujhe|mera|meri)\b/;

const NAME_WORDS: [RegExp, PersonName][] = [
  [/\bmeera\b/, { noun: 'Meera', g: 'n' }], [/\b(wife|patni)\b/, { noun: 'your wife', g: 'f' }], [/\b(husband|pati)\b/, { noun: 'your husband', g: 'm' }],
  [/\bkabir\b/, { noun: 'Kabir', g: 'm' }], [/\b(brother|bhai)\b/, { noun: 'your brother', g: 'm' }], [/\b(sister|didi)\b/, { noun: 'your sister', g: 'f' }],
  [/\b(grandmother|grandma|dadi|nani)\b/, { noun: 'your grandmother', g: 'f' }], [/\b(grandfather|grandpa|dada|nana)\b/, { noun: 'your grandfather', g: 'm' }],
  [/\b(mother[- ]in[- ]law|saas)\b/, { noun: 'your mother-in-law', g: 'f' }], [/\b(father[- ]in[- ]law|sasur)\b/, { noun: 'your father-in-law', g: 'm' }],
  [/\bin-?laws\b|\bparents[- ]in[- ]law\b/, { noun: 'your in-laws', g: 'pl' }],
  [/\b(friend|cousin|uncle|aunt|aunty|nephew|niece|colleague|neighbou?r|maid|driver)\b/, { noun: 'your $1', g: 'n' }],
];
const DEFAULT_NAME: Record<Person, PersonName> = {
  self: { noun: 'you', g: 'n' }, spouse: { noun: 'your spouse', g: 'n' }, son: { noun: 'your son', g: 'm' }, daughter: { noun: 'your daughter', g: 'f' },
  father: { noun: 'your father', g: 'm' }, mother: { noun: 'your mother', g: 'f' }, sibling: { noun: 'your sibling', g: 'n' },
  grandparent: { noun: 'your grandparent', g: 'n' }, inlaw: { noun: 'your in-law', g: 'n' }, other: { noun: 'this person', g: 'n' },
};
function nameFor(person: Person, t: string): PersonName {
  const groups: Partial<Record<Person, number[]>> = { spouse: [0, 1, 2], son: [3], sibling: [4, 5], grandparent: [6, 7], inlaw: [8, 9, 10], other: [11] };
  for (const i of groups[person] ?? []) {
    const [re, n] = NAME_WORDS[i];
    const m = t.match(re);
    if (m) return { ...n, noun: n.noun.replace('$1', m[1] ?? '') };
  }
  return DEFAULT_NAME[person];
}

function detectPersons(t: string): Person[] {
  const found: { p: Person; at: number }[] = [];
  let rest = t;
  for (const [p, re] of PERSON_CUES) {
    const m = rest.match(re);
    if (m) {
      found.push({ p, at: m.index ?? 0 });
      rest = rest.replace(new RegExp(re.source, 'g'), (s) => ' '.repeat(s.length)); // "mother-in-law" is not also "mother"
    }
  }
  // "parents" without "in-law": both parents
  if (/\bparents\b/.test(rest)) {
    const at = rest.search(/\bparents\b/);
    found.push({ p: 'father', at }, { p: 'mother', at: at + 1 });
  }
  const people = found.sort((a, b) => a.at - b.at).map((f) => f.p).filter((p, i, a) => a.indexOf(p) === i);
  if (people.length === 0 && SELF.test(t)) people.push('self');
  return people;
}

const ADMITTED = /\b((is|are|was|been|currently) (in|at) (riverside|greenfield|lotus|sahyadri)|had (his|her|my|an?|the) [a-z ]{0,20}(removed|surgery|operation)|removed (yesterday|today|last night)|admitted|admit (hai|ho|kiya)|bharti|in (the )?(hospital|icu|ccu|ward|emergency room|casualty)|hospital (mein|me)\b|hospitali[sz]ed|in icu|icu|ccu|ventilator|being operated|undergoing|on oxygen|had (a |an |his |her |my )?(surgery|operation|procedure|angioplasty|bypass|stent)|got operated|is operated|surgery (today|yesterday|done)|operated (on )?(today|yesterday))\b/;
const DISCHARGED = /\b(discharged|discharge (ho|hua)|came (back )?home|back home|after (a |the |his |her |my )?(hospital|stay)|paid (the )?(bill|hospital|cash|in cash|myself|out of pocket|from my pocket)|already paid|i paid|we paid|have the bills)\b/;
const PLANNED = /\b(planned|planning|scheduled|next (week|month|year)|in (a|two|three|\d+) (weeks?|months?)|advised|recommended|suggested|going to (have|get|undergo)|will (have|undergo|get)|wants? to (have|get|do)|needs? (an? |his |her |my )?(surgery|operation|procedure|replacement)|has to (get|have|undergo)|book(ed|ing)?|upcoming)\b/;
const ACUTE = /\b(chest pain|heart attack|cardiac arrest|unconscious|not responding|unresponsive|collapsed|fainted|can'?t breathe|cannot breathe|not breathing|breathless|difficulty breathing|seizure|fits|stroke|heavy bleeding|bleeding (a lot|heavily|badly)|choking|overdose|poison\w*|severe pain|accident)\b/;
const NOW = /\b(right now|just now|now|currently|at the moment|suddenly|abhi|is having|having|can'?t|cannot|isn'?t|not breathing|help|urgent|urgently|just (had|happened|met)|happening|is (unconscious|bleeding|collapsed|choking|not responding|breathless)|(he|she)'?s (bleeding|unconscious|collapsed|choking|not breathing)|has (chest pain|collapsed|fainted)|ho raha)\b/;
/** Markers that override past tense: "just had an accident, he's bleeding". */
const STRONG_NOW = /\b(right now|just now|abhi|currently|at the moment|is having|just (had|happened|met)|(he|she)'?s (bleeding|unconscious|collapsed|choking|not breathing)|is (unconscious|bleeding|not breathing)|can'?t breathe|cannot breathe|ho raha)\b/;
const PAST = /\b(\d+|a few|few|two|three|four|five|six|several|some) (years?|months?|weeks?) ago\b|\blast (year|month)\b|\bin 20\d\d\b|\bhistory of\b/;
const INCIDENT = /\b(had (a |an )?(heart attack|stroke|accident|fall|fracture|seizure|cardiac arrest)|was (injured|hurt|hit)|got (injured|hurt|hit)|fell|broke|met with|accident (happened|yesterday|today))\b/;

export function readSituation(text: string): Situation {
  const t = text.toLowerCase();
  const persons = detectPersons(t);
  let topic = TOPICS.find((x) => x.re.test(t));
  // "knee" in a fall/accident is an injury, not a planned joint replacement
  if (topic?.id === 'joint' && /\b(fell|fall|accident|injur\w*|fractur\w*|broke)\b/.test(t) && !/replacement/.test(t)) topic = TOPICS.find((x) => x.id === 'accident');
  const accident = /\b(accident|injur\w*|fractur\w*|broke|broken|fell|fall|hit by|burns?)\b/.test(t);
  const past = PAST.test(t);

  let care: CareState = 'none';
  if (ADMITTED.test(t)) care = 'admitted';
  else if (DISCHARGED.test(t)) care = 'discharged';
  else if (ACUTE.test(t) && !past && (STRONG_NOW.test(t) || (NOW.test(t) && !/\b(had|was|got)\b/.test(t)))) care = 'emergency_now';
  else if (PLANNED.test(t)) care = 'planned';
  else if ((INCIDENT.test(t) || (ACUTE.test(t) && /\b(had|was|got|met)\b/.test(t))) && !past) care = 'incident';
  // "if I go to hospital…", "what if…" are hypothetical, not events
  const hypothetical = /\b((if|when) (i|we|he|she|they|my \w+) (ever )?(go|goes|get|gets|am|is|are|were|was|need|needs|have|has) (to (the |a )?hospital|admitted|hospitali[sz]ed|into hospital|(an? )?(surgery|operation))|what if|suppose|in case)\b/.test(t);
  if (hypothetical && !/\b(right now|just now|currently)\b/.test(t) && (care === 'admitted' || care === 'emergency_now' || care === 'incident')) care = 'none';

  const claimBack = /\b(claim (for|back)|how (do|can|to) (i |we )?claim|file (a |the )?claim)\b/.test(t) && /\b(bill|bills|paid|receipts?|expenses)\b/.test(t);
  const payCash = claimBack || /\b(pay(ing)? (in )?cash|paid (in )?cash|cash payment|pay (from|out of) (my |our )?pocket|paid (myself|the bill|out of pocket|from my pocket)|reimburs\w*|already paid|pay (first|myself|upfront)|paid upfront|claim (it )?back|get (the |my )?money back|refund)\b/.test(t);
  const wantsCashless = /\bcashless\b/.test(t);
  const hospital = ['riverside', 'greenfield', 'lotus', 'sahyadri'].find((h) => t.includes(h));
  const nonNetworkHospital = /\b(non-?network|not (in|on) (the )?(network|list|panel)|outside (the )?network|not empanell?ed|other hospital|any hospital|another hospital|private hospital|small hospital|local hospital|nursing home)\b/.test(t);
  const names: Situation['names'] = {};
  for (const p of persons) names[p] = nameFor(p, t);
  if (topic?.id === 'dengue') {
    const word = t.match(topic.re)?.[0] ?? 'fever';
    topic = { ...topic, label: `${word} treatment` };
  }
  return {
    raw: t,
    names,
    persons,
    person: persons[0],
    care,
    topic,
    preExisting: (topic?.kind === 'chronic') || PRE_EXISTING.test(t) || (past && !!topic?.oftenPreExisting),
    payCash,
    wantsCashless,
    hospital,
    nonNetworkHospital,
    bill: parseAmount(text),
    wantsCost: /\b(how much|out[- ]of[- ]pocket|cost|costs|my share|our share|extra|have to pay|pay anything|will i (have to )?pay|do i (have to )?pay|what will i pay|deduct\w*)\b/.test(t),
    accident,
  };
}

export function parseAmount(text: string): number | undefined {
  const m = text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|lac|k|crore|cr)?|([\d,]{3,}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|k|rupees|crore|cr)\b|([\d,]{4,}(?:\.\d+)?)/i);
  if (!m) return undefined;
  const num = parseFloat((m[1] ?? m[3] ?? m[5]).replace(/,/g, ''));
  const unit = (m[2] ?? m[4] ?? '').toLowerCase();
  if (!num) return undefined;
  if (unit.startsWith('la')) return num * 100000;
  if (unit.startsWith('cr')) return num * 10000000;
  return unit === 'k' ? num * 1000 : num;
}

/** How the engine refers to a person in a sentence. */
export const PERSON_NOUN: Record<Person, string> = {
  self: 'you', spouse: 'your spouse', son: 'your son', daughter: 'your daughter', father: 'your father', mother: 'your mother',
  sibling: 'your sibling', grandparent: 'your grandparent', inlaw: 'your in-law', other: 'this person',
};
export const PERSON_POSSESSIVE: Record<Person, string> = {
  self: 'your', spouse: 'your spouse’s', son: 'your son’s', daughter: 'your daughter’s', father: 'your father’s', mother: 'your mother’s',
  sibling: 'your sibling’s', grandparent: 'your grandparent’s', inlaw: 'your in-law’s', other: 'their',
};

/** Matches a person to an entry in a policy's insured list. */
export function insuredEntry(insured: string[], person: Person): string | undefined {
  const re: Partial<Record<Person, RegExp>> = {
    self: /\((self|employee|life assured)\)/i, spouse: /\(spouse\)/i, son: /\(son\)/i, daughter: /\(daughter\)/i,
    father: /\(father\)/i, mother: /\(mother\)/i,
  };
  const r = re[person];
  return r ? insured.find((i) => r.test(i)) : undefined;
}

/** Term-life cues used by the life checks. */
export function readLifeContext(text: string) {
  const t = text.toLowerCase();
  const notDisclosed = /\b(didn'?t|did not|never|not|forgot to) (declare|disclose|tell|mention|inform)|\bhid\b|\bhidden\b|undisclosed|\blied\b|without (declaring|disclosing|telling)/.test(t);
  return {
    raw: t,
    suicide: /\b(suicide|suicidal|kill (my|him|her)self|take (my|his|her) own life|end (my|his|her) life)\b/.test(t),
    abroad: /\b(abroad|overseas|outside india|foreign|another country|international|usa|us|uk|dubai|singapore|canada|europe|while travell?ing)\b/.test(t),
    accident: /\b(accident\w*|road|crash|mishap)\b/.test(t),
    notDisclosed,
    disclosureTopic: notDisclosed || /\b(smok\w*|tobacco|cigarettes?|drinking habit|disclos\w*|declar\w*|medical history|section 45|contest\w*)\b/.test(t),
    missedPremium: /\b(missed|miss|lapse|lapsed|forgot (to pay)?|not paid|unpaid|overdue|grace|late (premium|payment)|revive|revival|reinstate|stop paying|can'?t pay)\b/.test(t),
    intoxication: /\b(drunk|alcohol|intoxicat\w*|under the influence|drugs)\b/.test(t),
  };
}
