# Voice and copy

How the product talks. Use it for answer copy (`server/`), prompts (`src/prompts.ts`) and every UI screen. This is an unofficial concept that uses sample data. It isn't a Ditto product.

## Voice

Write the way Ditto's advisors talk: plainly, warmly and honestly, like a friend who knows insurance well. No jargon, no sales talk and no false comfort. When the news is bad, say so and then say what can be done.

- **Answer first.** The headline answers the question that was asked ("Yes", "No", "Not yet", "Not all of it"), then gives the reason.
- **Short sentences, active voice, second person.** "Tell the insurer within 24 hours", not "The insurer must be intimated".
- **One idea per key point.** Key points add to the headline and never repeat it. Factors carry the detail.
- **Use Indian English and Indian conventions.** Write hospitalisation, enrolment, ₹5,000, ₹3 lakh, ₹1 crore and "till 30 Jun 2027".
- **Use numerals with units.** 24 hours, 30 days, 20%, ₹75,000 per delivery, ₹5,000 a day (not "/day" in sentences).
- **Write dates as "1 Jul 2027".** Use the three-letter month, with no ordinal and no comma.
- **Use sentence case for labels, headings and buttons.** Write "Cashless for planned surgery", not "Cashless For Planned Surgery".
- **People.** Use they/them for a spouse, partner, Meera or anyone else whose gender the user hasn't given. Use he/she only when the user's words or the relationship word imply it (father, mother, son, wife, husband).
- **Who's speaking.** The assistant may say "I" ("I'll work out your share"). It never speaks as the insurer, as Ditto staff, or as "we". It never claims to be AI or to be "thinking".

## Glossary: one term per concept

| Use | Explain on first use as | Don't use |
|---|---|---|
| sum insured | the most the policy pays in a year | coverage amount, SI |
| cashless | the insurer pays a network hospital directly | direct settlement |
| reimbursement | you pay the hospital, then claim the money back | refund, claim back (as a noun) |
| network hospital | a hospital on the policy's cashless list | empanelled, panel hospital |
| co-pay | the share of every claim you pay | co-payment, deductible |
| sub-limit | a cap on one kind of treatment | cap (on its own), max |
| room rent limit | the most the policy pays for the room each day | room eligibility |
| waiting period / wait | time before a condition is covered | cooling period |
| pre-existing condition | a condition you had before buying the policy | PED |
| TPA | "the insurer's claims desk (TPA)" the first time it appears | TPA on its own on first use |
| tell the insurer | (for claim intimation) | intimate, inform |
| pre-authorisation | cashless approval before a planned stay | pre-auth |
| nominee | the person who receives a term payout | beneficiary |
| grace period | the days you have to pay after the due date | — |
| higher premium | (for a premium loading) | loading (on its own) |

## Punctuation

- Use **at most one em dash per sentence**. The usual one follows the answer word: "Yes — Employer Group Health covers…". Otherwise, use a comma, "so", "but" or a full stop.
- **Avoid semicolons in key points.** Split the point into two short sentences.
- Use **"·" only in metadata lines**, such as tool steps and plan details ("Policy no. EGH-55102 · patient ID"). Don't use it in sentences or lists of items. Write those out with commas and "and".
- Use **curly apostrophes and quotes** (’ “ ”). Don't use exclamation marks.
- End headlines and key points with a full stop. Labels, factor summaries and buttons have no full stop.

## Tone by situation

- **Good news.** Confirm it, then give the one condition that matters most: "Yes — Family Floater Shield covers cataract surgery, up to ₹40,000 per eye."
- **Bad news.** Be direct and kind, then say what can be done: "No — your mother isn't on any of your policies, so this hospital bill isn't covered." Then give the ways to add her and any other cover she might have.
- **Uncertain.** Say what is unknown and who can confirm it: "Unclear — Employer Group Health doesn't mention mental health treatment, so ask the insurer before treatment."
- **Emergency.** Keep it calm and minimal, with care first: "Get care first: call 112 or go to the nearest hospital. Insurance can wait until after admission." Don't add a 112 step for someone already admitted.
- **Never guarantee.** "Only the insurer can approve a claim" is the limit of what can be promised.

## Buttons, errors and empty states

- **Buttons** start with a verb and say what happens: "Ask", "Show clauses", "Compare policies". Don't write "Submit" or "Click here".
- **Suggested questions** are written the way a person would ask them: "Which hospitals are cashless for my father?"
- **Errors** say what happened and what to do next, without blame: "That doesn't look like a question — describe what happened in a sentence, or try one of these."
- **Empty states** say what's missing and offer one action: "No claims yet. Ask how a claim works."
- **Out of scope:** "I can help with health and term life insurance only, not car, travel or home."

## Avoid

"simply", "just", "please note", "kindly", "rest assured", "hassle-free", "seamless", exclamation marks, "AI-powered", "smart", "we" (as the insurer or Ditto), "intimate", "admissible", "arrears", and a "·" chain inside a sentence.

## Before and after

| Before | After |
|---|---|
| Yes — Employer Group Health covers your father’s hospital stay for heart treatment; cashless if the hospital is in its network. | Yes — Employer Group Health covers your father’s hospital stay for heart treatment. |
| Inform the TPA within 24 hours — HR benefits desk ext. 4410. | Tell the insurer’s claims desk (TPA) within 24 hours: HR benefits desk ext. 4410. |
| You’d pay: 20% co-pay · anything above ₹3,00,000 (cardiac procedures sub-limit) · room costs above ₹5,000/day · non-medical items. | You’d pay the 20% co-pay, anything above the ₹3,00,000 cardiac procedures limit, non-medical items and more if the room costs over ₹5,000 a day. |
| Routine medicines, tests and doctor visits aren’t covered — only hospital stays. | Only hospital stays are covered, not routine medicines, tests or doctor visits. |
| Waiting period done: 24-month wait for cataract surgery ended 1 Jul 2025. | The 24-month wait for cataract surgery ended on 1 Jul 2025. |
| Get care first — call 112. Insurance can be sorted after admission. | Get care first: call 112 or go to the nearest hospital. Insurance can wait until after admission. |
| Please ask the full question — I answer each message on its own. | Could you ask the full question? I answer each message on its own. |
