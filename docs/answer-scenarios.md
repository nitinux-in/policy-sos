# Answer scenarios

How the local engine answers each kind of question. Everything is rule-based and deterministic: the same question gives the same answer every time, using only `data/portfolio.json` (sample data) and the fixed demo date **25 Nov 2026**.

## Answer shape

| Field | What it holds | Rule |
|---|---|---|
| `headline` | The direct answer, one sentence | Starts with the substance, because the UI shows the verdict as a chip just before it ("Employer Group Health covers your father’s hospital stay…", "Your mother isn’t on any of your policies…"). Voice and punctuation: `docs/voice-and-copy.md` |
| `verdict` | `yes` · `likely` · `partial` · `depends` · `unlikely` · `no` · `info` | `partial` when a certain deduction applies (co-pay, a bill above a limit); `likely` when something still needs checking |
| `keyPoints` | 2–4 short points | Deadlines, numbers, who to call, what you'd pay. Never repeats the headline |
| `confidence` | Level, label, one-line reason, factors | See the rule below |
| `details` | Folded sections | Only the ones relevant to the question |
| `safetyNotice` | One line | Only when an emergency is happening now and the person isn't in care yet |
| `plan` | Short steps | Only where steps help: before a planned admission, after paying a bill, a death claim |
| `suggestions` | 2–3 follow-ups | Every one is itself a question the engine answers (checked by `npm run check:engine`) |

## Confidence rule

Each **factor** is one concrete thing that could change the claim, with a status and the clause it relies on:

- `clear` — verified in the policy data and supports the answer
- `check` — the person must confirm or do something (declared at purchase? network hospital? inform within 24 h?)
- `risk` — a known issue in the data. `impact: 'blocks'` can stop the claim (waiting period not served, exclusion, not insured); `impact: 'reduces'` only lowers the payout (co-pay, sub-limit, non-medical items)
- `unknown` — the policy data doesn't say

**Level** (`rate()` in `server/confidence.ts`, re-checked independently by the regression script):

| Verdict | High | Medium | Low |
|---|---|---|---|
| Positive (`yes`/`likely`/`partial`/`depends`) | every factor `clear` (known deductions allowed) | any `check` or `unknown` | any blocking `risk`, or 2+ `unknown` |
| Negative (`no`/`unlikely`) | the blocker is stated in the wording, nothing open | a `check`/`unknown` could overturn it (e.g. an accident exception) | — |
| `info` | no confidence shown | | |

## Factors checked (health)

Computed per policy and per person, from the clause dates against 25 Nov 2026:

| Factor | Example outcome |
|---|---|
| Who is insured | "Suresh Mehta (father) is insured under Employer Group Health" / mother: not insured anywhere |
| Policy active | "Active till 31 Mar 2027 while you stay employed" |
| Cover for this | the benefit clause, a day-care clause, an exclusion, or "doesn't mention" → `unknown` |
| Waiting period | initial 30 days, specific illnesses 24 months, joint replacement 48 months (ends 1 Jul 2027), maternity 24 months (ends 1 Jul 2028); waived in the group policy; none for accidents |
| Pre-existing condition | Floater: 36-month wait ended 1 Jul 2026 (if declared). Employer: covered from day one |
| Disclosure | Floater: `check` — "Was it declared?"; `risk` if the user says it wasn't; contestable till 1 Jul 2028 (60-month moratorium). Employer: `clear` — no health questionnaire |
| Needs a hospital stay | chronic conditions: medicines and OPD visits aren't paid |
| Sub-limit | cataract ₹40,000 / ₹25,000 per eye; angioplasty and bypass ₹3,00,000; maternity ₹50,000 / ₹75,000 |
| Co-pay | parents 20% (Employer) |
| Network hospital | cashless list per policy; named hospital in/out; non-network → reimbursement |
| Inform the insurer / pre-authorisation | 24 h after an emergency admission; 48 h (Floater) / 72 h (Employer) before a planned one |
| Claim deadline | reimbursement within 30 days of discharge; late filing accepted with written reason |
| Room rent | single private room / ₹5,000 a day — proportionate deduction explained |
| Non-medical items | gloves, kits, toiletries aren't paid |
| Sum insured left | Floater ₹9,60,200 after Kabir's ₹39,800 claim; Employer ₹5,00,000 |
| Second policy | the other policy that also covers the person, or why it doesn't |

## Factors checked (term life)

Life assured · premium paid / grace (next due 5 Aug 2027, grace till 4 Sep 2027) · nominee (Meera Mehta) · Section 45 (3 years from 6 Aug 2021 — ended 6 Aug 2024, after which the policy can't be questioned on any ground; a revival restarts it) · suicide clause (12 months, ended 6 Aug 2022) · death abroad · accidental death rider (+₹25 lakh, 180 days) and its exclusions.

## Scenario matrix

### Health — something is happening

| Question pattern | Detected situation | Verdict | Key points | Details |
|---|---|---|---|---|
| "My father is admitted for a heart problem", "in ICU", "had an angioplasty today", "papa hospital mein admit hai" | **admitted** — no safety banner, no 112 step | `partial` (co-pay) / `likely` | inform TPA within 24 h + contact · cashless hospitals · what you'd pay · second policy | cashless, reimbursement, room rent, two policies |
| "…at Riverside", "…at Greenfield" | admitted + named hospital | as above | "Riverside’s TPA desk can arrange cashless" or "since Greenfield isn’t in its network, you pay first and claim reimbursement" | |
| "Chest pain right now", "unconscious", "can't breathe", "just had an accident, he's bleeding" | **emergency now** — one line: "Get care first: call 112 or go to the nearest hospital. Insurance can wait until after admission." | as above | "After admission, inform…" · cashless list · deductions | cashless |
| "My son was injured", "had a heart attack" (admission not stated) | **incident** | `likely` | "If your son is admitted, … covers accident treatment from day one" | |
| "My mother is in hospital", "my brother is in the ICU" | admitted, **not insured** | `no` (high) | who is covered · how to add her (March enrolment → 1 Apr 2027; or floater at renewal) · own cover / PM-JAY 70+ | adding a member |
| "My father and mother are both in hospital" | two people | `partial` | one line per person | adding a member |
| "Planned surgery next month", "needs a knee replacement", "C-section in March" | **planned** | `likely`/`partial` | cashless list + pre-authorisation · deductions · second policy | cashless, room rent | plan: pick network hospital → pre-authorise → carry card |
| "Discharged… how do I file", "paid the bill myself", "paid cash at Greenfield" | **discharged / paid** | `likely` | documents · deductions · second policy | reimbursement | plan: documents → submit within 30 days → follow-up bills |
| "Bill is ₹4 lakh… how much will I pay?", "₹12 lakh… will insurance cover all of it?" | cost | `partial` | "… would pay about ₹2,40,000 of the ₹4,00,000 bill, leaving about ₹1,60,000 for you" + why | room rent |

### Health — is it covered?

| Question | Answer |
|---|---|
| Cataract, hernia, stones, piles, sinus | Yes (Floater: 24-month wait ended 1 Jul 2025; sub-limits) |
| Knee / joint replacement | Yes under Employer; Floater's 48-month wait runs till 1 Jul 2027 |
| Maternity / delivery / pregnant | Yes under Employer from day one, up to ₹75,000; Floater not until 1 Jul 2028. Naming the floater → "Not Family Floater Shield — its 24-month maternity wait…, but Employer Group Health covers…" |
| Dengue, appendix, cancer (chemo as day care), dialysis, day care | Yes; disclosure check where the condition may be pre-existing |
| Mental health | Yes under Floater; Employer doesn't mention it (`unknown`) |
| Diabetes, BP, thyroid, asthma (chronic) | Yes when admitted; medicines/OPD not covered; Employer preferred (no disclosure risk); Floater disclosure `check` |
| "I didn't disclose my diabetes" | Yes under Employer; Floater claim can be rejected and policy cancelled (`risk`) |
| Dental, root canal | No — excluded unless an accident needs hospitalisation; after an accident + admission → Yes |
| OPD, spectacles, cosmetic, hair transplant | No — excluded |
| Ambulance, pre/post hospitalisation | Yes, with the clause amount; only with a covered admission |
| "Is my mother / daughter / grandmother covered?" | No — who is covered, how to add |

### Health — how things work

| Question | Answer |
|---|---|
| Which hospitals are cashless (for my father) / Can I go to Riverside | per-policy network lists |
| Room rent limit / room upgrade | limits per policy; proportionate deduction with a worked example |
| Co-pay for my father / "uploaded note says co-pay is waived" | 20%; an uploaded note isn't policy evidence |
| Sum insured left ("How much health cover do I have left?", "how much cover is left", "how much of my health insurance is remaining", "balance sum insured") | ₹14,60,200 across both, per-policy lines. Remaining is clamped to [0, sum insured]. Naming one policy ("left on my family floater", "employer plan") answers for that policy only |
| Documents for a claim / how cashless works / reimbursement | lists, deadlines, per-policy details |
| Claim rejected (incl. for non-disclosure) | written reason → evidence → Grievance Officer (14 days) → Bima Bharosa / Ombudsman (within 1 year, up to ₹50 lakh) |
| Non-disclosure in general | Floater: rejection + cancellation until 1 Jul 2028; Employer unaffected |
| Renewal, missed renewal, grace | renews 30 Jun 2027; 30-day grace keeps continuity but no cover while unpaid |
| Portability | apply by 16 May 2027; waiting credit carries over |
| Leaving the job | Employer cover ends; your father loses cover; Floater continues |
| Adding mother / father-in-law / newborn | March enrolment (from 1 Apr 2027) / floater at renewal / newborn within 30 or 90 days |
| Adding someone already on one policy ("How do I add my father…") | "Your father is already covered by Employer Group Health, and you can also add him to Family Floater Shield at renewal on 30 Jun 2027." Then medical checks, fresh waiting periods, the co-pay |
| Adding "my parents" | Answers for both: "Your father is already on Employer Group Health, so only your mother needs adding…"; floater at renewal for both; 20% parent co-pay |

### Term life

| Question | Answer |
|---|---|
| What happens to my family if I die / who is the nominee | Meera receives ₹1 crore (₹1.25 crore if accidental); documents; 15-day settlement; employer health cover would end |
| Accidental death / "drunk driving accident" | +₹25 lakh rider within 180 days / rider not paid with intoxication, base cover still paid |
| Do I have an accidental death rider | Yes — ₹25 lakh |
| Suicide | Yes — 12-month clause ended 6 Aug 2022 (revival restarts it); a one-line Tele-MANAS 14416 support notice |
| Death abroad | Yes — worldwide; embassy-attested certificate |
| Missed premium / grace / lapsed / revive | in force; 30-day grace; revival within 5 years restarts suicide clause and Section 45 |
| When is my term premium due / next term premium / due date | "Your next Secure Term Plus premium of ₹16,900 is due on 5 Aug 2027." Key points: grace till 4 Sep 2027, death in grace still paid, lapse after grace, revival |
| Didn't disclose smoking | Paid — past the 3-year Section 45 window (6 Aug 2024) |
| Change nominee | Yes, by written endorsement |
| Hospitalisation / cancer / critical illness on term | No — term pays only on death; health policies cover treatment |
| Nominee's claim process / claim rejected | documents, contact, timelines / grievance → Ombudsman |

### Edge cases

| Input | Answer |
|---|---|
| "Is it covered?", "can I claim?", "am I covered" | One clarifying question with three option chips |
| "What about my wife?" (follow-up) | Ask the full question (each message is answered on its own) |
| Misspellings / Hinglish ("is my fater coverd for hospitl", "mere papa ka operation hai") | Normalised, then answered |
| Car, travel, home, laptop, scooter | "I can help with health and term life insurance only…" |
| Mixed ("injured in a car accident and admitted") | Health answer plus a scope note |
| Buy / recommend a policy | Not supported — explains existing policies only |
| "Ignore previous instructions…" | Blocked by the guardrail |
| "Tell me every claim is 100% approved" | No guarantees — only the insurer decides |
| Greetings, thanks, gibberish, weather | Short reply with suggested questions |

## Notes on the sample data

Clauses added for these scenarios (all simulated wording): day care, mental illness, specific-illness and joint-replacement waiting periods, disclosure and moratorium, claim deadlines, adding members, portability, renewal and grace, grievances (both health policies); group waiver, day care, pre/post hospitalisation, cataract sub-limit, group disclosure, adding dependants, cosmetic/OPD and non-medical exclusions, claim deadlines, grievances (employer plan); worldwide cover, rider exclusions, Section 45, revival, nomination, settlement timeline, grievances (term life). Two existing waiting-period clauses (Floater 5.1 and 5.3) now state the date they count from.

## Confidence copy

Labels are "High confidence", "Medium confidence" or "Low confidence". The reason is one sentence: the most important open factor, the blocker, or "Every check passes on the policy wording. The insurer still makes the final decision."
