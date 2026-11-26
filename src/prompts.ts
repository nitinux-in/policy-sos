// Curated demo prompts (health and term life only). Each one is covered by the local demo engine's
// scenarios (see docs/answer-scenarios.md) and produces the same answer on every run. All of them are
// regression-tested in scripts/engine-cases.json.

import { Baby, BedDouble, FileCheck2, Hospital, Receipt, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';

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

/** Home: quick questions under the search bar — the everyday ones people ask most */
export const HOME_CHIPS: { label: string; q: string }[] = [
  { label: 'File a claim', q: 'How do I file a claim?' },
  { label: 'Cashless hospitals', q: 'Which hospitals are cashless?' },
  { label: 'Room rent limit', q: PROMPTS.roomRent },
  { label: 'What’s not covered', q: 'What is not covered in my policy?' },
];

/** Phone assistant start screen: the everyday questions (same as the home chips) */
export const LANDING: { title: string; q: string; icon: LucideIcon }[] = [
  { title: 'File a claim', q: 'How do I file a claim?', icon: FileCheck2 },
  { title: 'Cashless hospitals', q: 'Which hospitals are cashless?', icon: Hospital },
  { title: 'Room rent limit', q: PROMPTS.roomRent, icon: BedDouble },
  { title: 'What’s not covered', q: 'What is not covered in my policy?', icon: ShieldCheck },
];

/** Assistant landing tiles */
export const FEATURED: { title: string; hint: string; icon: LucideIcon; q: string; urgent?: boolean }[] = [
  { title: 'In hospital', hint: 'Dad’s in hospital', icon: Hospital, q: PROMPTS.emergency, urgent: true },
  { title: 'Pay, then claim', hint: 'Claim a cash bill', icon: Receipt, q: PROMPTS.preExisting },
  { title: 'Check cover', hint: 'Maternity cover', icon: Baby, q: PROMPTS.maternity },
  { title: 'Term life', hint: 'My family’s payout', icon: ShieldCheck, q: PROMPTS.termNominee },
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
