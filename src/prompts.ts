// Curated demo prompts (health and term life only). Each one is covered by the local demo engine's
// intents and produces the same answer on every run.

import { Baby, BedDouble, FileCheck2, Hospital, OctagonAlert, Scale, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';

export const PROMPTS = {
  emergency: 'My father has been admitted after a cardiac emergency. Which policy can help, and what should I do?',
  maternity: 'Is maternity covered for my wife?',
  compareHealth: 'Compare my health policies',
  termNominee: 'Who is the nominee on my term life policy, and what would my family receive?',
  cashless: 'I have a planned surgery next month. How do I get cashless treatment?',
  reimbursement: 'My son was discharged after a hospital stay. How do I file a reimbursement claim?',
  termClaim: 'How does my nominee make a claim on my term life policy?',
  roomRent: 'What is my room rent limit?',
} as const;

/** Assistant landing tiles */
export const FEATURED: { title: string; hint: string; icon: LucideIcon; q: string; urgent?: boolean }[] = [
  { title: 'Emergency', hint: 'Someone’s in hospital', icon: OctagonAlert, q: PROMPTS.emergency, urgent: true },
  { title: 'Check cover', hint: 'Maternity for my wife', icon: Baby, q: PROMPTS.maternity },
  { title: 'Compare plans', hint: 'My two health plans', icon: Scale, q: PROMPTS.compareHealth },
  { title: 'Term life', hint: 'Nominee and payout', icon: ShieldCheck, q: PROMPTS.termNominee },
];

/** Claims screen shortcuts */
export const CLAIM_SHORTCUTS: { label: string; q: string }[] = [
  { label: 'Cashless for a planned surgery', q: PROMPTS.cashless },
  { label: 'Reimbursement after a hospital stay', q: PROMPTS.reimbursement },
  { label: 'Term life claim: what the nominee needs', q: PROMPTS.termClaim },
];

/** Assistant start screen on phones: popular topics */
export const POPULAR_TOPICS: { label: string; q: string; icon: LucideIcon }[] = [
  { label: 'Cashless for a planned surgery', q: PROMPTS.cashless, icon: Hospital },
  { label: 'Reimbursement after a hospital stay', q: PROMPTS.reimbursement, icon: FileCheck2 },
  { label: 'Term life claim: what the nominee needs', q: PROMPTS.termClaim, icon: UserRound },
  { label: 'My room rent limit', q: PROMPTS.roomRent, icon: BedDouble },
];

/** Overview quick questions */
export const OVERVIEW_QUESTIONS: string[] = [PROMPTS.maternity, PROMPTS.compareHealth, PROMPTS.termNominee];
