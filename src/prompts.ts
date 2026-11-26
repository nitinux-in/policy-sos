// Curated demo prompts (health and term life only). Each one is covered by the local demo engine's
// scenarios (see docs/answer-scenarios.md) and produces the same answer on every run. All of them are
// regression-tested in scripts/engine-cases.json.

import { Baby, BedDouble, FileCheck2, Hospital, OctagonAlert, Pill, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';

export const PROMPTS = {
  emergency: 'My father is admitted in hospital for a heart problem',
  maternity: 'Is maternity covered for my spouse?',
  compareHealth: 'Compare my health policies',
  termNominee: 'What happens to my family if I die?',
  cashless: 'I have a planned surgery next month. How do I get cashless treatment?',
  reimbursement: 'My son was discharged after a hospital stay. How do I file a reimbursement claim?',
  termClaim: 'How does my nominee make a claim on my term life policy?',
  roomRent: 'What is my room rent limit?',
  preExisting: 'I have diabetes, if I get treated and pay cash will I be reimbursed?',
  rejected: 'My health claim was rejected. What can I do?',
} as const;

/** Assistant landing tiles */
export const FEATURED: { title: string; hint: string; icon: LucideIcon; q: string; urgent?: boolean }[] = [
  { title: 'In hospital', hint: 'Dad’s admitted for his heart', icon: OctagonAlert, q: PROMPTS.emergency, urgent: true },
  { title: 'Pay, then claim', hint: 'Diabetes treatment paid in cash', icon: Pill, q: PROMPTS.preExisting },
  { title: 'Check cover', hint: 'Maternity cover', icon: Baby, q: PROMPTS.maternity },
  { title: 'Term life', hint: 'What my family receives', icon: ShieldCheck, q: PROMPTS.termNominee },
];

/** Claims screen shortcuts */
export const CLAIM_SHORTCUTS: { label: string; q: string }[] = [
  { label: 'Cashless for planned surgery', q: PROMPTS.cashless },
  { label: 'Reimbursement after a hospital stay', q: PROMPTS.reimbursement },
  { label: 'If a claim is rejected', q: PROMPTS.rejected },
  { label: 'What the nominee needs to claim', q: PROMPTS.termClaim },
];

/** Assistant start screen on phones: popular topics */
export const POPULAR_TOPICS: { label: string; q: string; icon: LucideIcon }[] = [
  { label: 'Cashless for planned surgery', q: PROMPTS.cashless, icon: Hospital },
  { label: 'Reimbursement after a hospital stay', q: PROMPTS.reimbursement, icon: FileCheck2 },
  { label: 'What the nominee needs to claim', q: PROMPTS.termClaim, icon: UserRound },
  { label: 'Room rent limit', q: PROMPTS.roomRent, icon: BedDouble },
];

/** Overview quick questions */
export const OVERVIEW_QUESTIONS: string[] = [PROMPTS.maternity, PROMPTS.compareHealth, PROMPTS.termNominee];
