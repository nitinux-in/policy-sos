# Ditto Insurance Companion

A policy assistant for **health and term life insurance**: it explains what your policies say, checks a situation against the policy wording, compares plans, estimates out-of-pocket costs when there's enough information, and prepares claim steps.

> Portfolio project (Mission 003 of a 100-day build challenge). All people, insurers, policies, clauses and claims are **sample data**, not real contracts. Not an official Ditto product; the Ditto name and logo belong to Ditto.

## Run it

Requires a current Node.js (tested on Node 22). No API keys or external services.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The API runs on port 8787; Vite forwards `/api` requests to it.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app and API with live reload |
| `npm run typecheck` | Type-checks app, server and scripts |
| `npm run build` | Type-checks and builds the app into `dist/` |
| `npm start` | Builds, then serves the built app from the API server |
| `npm run check:engine` | Runs 152 assistant prompts twice, checks the answer contract and compares them with the saved snapshot (see below) |

Shortcut for demos: `http://localhost:5173/?ask=Compare%20my%20health%20policies` opens the assistant with that question.

## How answers are produced

There is **no AI model** behind the assistant — not Gemini or any other provider. The hackathon prototype this grew from used the Gemini API; that integration, its SDK and its API key have been removed entirely.

Every answer comes from a **deterministic local engine** (`server/agent.ts`):

1. **Safety checks** — unreadable input, attempts to change the rules, abuse.
2. **Situation** — the message is read into who is affected, what is happening (emergency right now, already admitted, planned, discharged/paid, or just a question), the treatment or condition, the hospital and any bill amount (`server/situation.ts`). Common misspellings and a few Hinglish words are normalised first.
3. **Tools** — a fixed sequence of local tools runs against the sample data (`server/tools.ts`): `searchPolicies`, `retrievePolicyEvidence`, `assessClaimFactors`, `comparePolicies`, `calculatePotentialCost`, `generateActionPlan`. The "How this answer was built" list in each answer shows the actual steps that ran.
4. **Claim factors** — `assessClaimFactors` (`server/confidence.ts`) checks everything that could change a claim: who is insured, policy active, waiting periods computed from clause dates, pre-existing conditions and disclosure, exclusions, network hospital, deadlines, co-pay, sub-limits, room rent and sum insured left.
5. **Answer** — composed from those results (`server/scenarios.ts`): a one-sentence **headline** that answers the question, up to four **key points**, a **confidence** rating built from the factors, and longer explanations folded into **details**. The same question always gets the same answer.

Answer rules: coverage statements cite clauses; approval is never guaranteed; a "call 112" line appears only when an emergency is happening now and the person isn't in care yet — someone already admitted gets the insurance answer directly; text in uploaded documents is treated as untrusted and any instructions in it are ignored.

The scenario matrix, the confidence rule and the factor list are in [`docs/answer-scenarios.md`](docs/answer-scenarios.md).

The engine answers each question on its own (no memory of earlier messages) and recognises common phrasings rather than any wording — the curated prompts below are the reliable path.

### Curated demo questions

- My father is admitted in hospital for a heart problem
- My father has chest pain right now
- I have diabetes, if I get treated and pay cash will I be reimbursed?
- Is cataract surgery covered?
- My mother is in hospital
- Is maternity covered for my wife?
- Compare my health policies
- What happens to my family if I die?
- I have a planned surgery next month. How do I get cashless treatment?
- My son was discharged after a hospital stay. How do I file a reimbursement claim?
- My father's hospital bill is ₹4 lakh for a cardiac procedure. How much will I pay?
- My health claim was rejected — what can I do?

## Scope and demo data

- **Health and term life only.** `data/portfolio.json` still contains the hackathon's motor, travel, home and personal accident records, but `scopePortfolio()` in `shared/demo.ts` filters them out on load, so they never reach the screens or the engine.
- **Fixed demo date: 25 Nov 2026** (`DEMO_TODAY` in `shared/demo.ts`). Renewal countdowns and waiting-period checks use it, so outputs never drift with the real clock.

## Design

The visual language is translated from Ditto's site (see `../DITTO_DESIGN_SYSTEM.md`), not copied from it. Ditto's site has no dashboard components, so the UI is built with **shadcn/ui** (Radix-based components in `src/components/ui`, added with the shadcn CLI) and themed entirely with Ditto tokens: every shadcn colour variable in `src/index.css` maps to a Ditto value, and the components were tuned to Ditto's 12px radius and 44px touch targets. The Ditto wordmark (light and dark versions) and a favicon cut from its blue mark live in `public/brand`.

- **Type:** Inter — the typeface on Ditto's live site — served locally as subset WOFF2 files (`public/fonts`, about 120 KB in total).
- **Colour:** tokens are in `src/index.css`. Near-black text with blue-grey neutrals, Ditto's link blue `#0871ea` for actions, focus and selection, muted status colours, and campaign yellow used once (the Overview question card).
- **Themes:** light by default, with a dark theme from the header toggle (remembered on that device). All text pairings pass WCAG AA in both themes.
- **Layout:** soft, airy surfaces — a cool light-grey page, borderless white cards with large radii, light-weight headings and figures. Desktop: Ditto logo, centred pill navigation (Home · Assistant · Policies · Claims · Documents), theme toggle and profile. Phones: logo header, compact cards and a floating dark pill navigation with the Ask button in the middle.
- **Assistant:** the hero. Home opens with a sky-gradient Ask card (pill search bar, quick questions, the Ditto mascot). The assistant is its own page: a centred conversation with the mascot as avatar and, from 1280 px, a right rail showing the latest answer's sources, unverified points and steps. On phones it opens full-screen with a sky header, quick questions and popular topics. Mascot artwork lives in `public/brand`.
- **Accessibility:** dialogs trap focus, close on Escape and return focus to their trigger; switching tabs moves focus to the page heading and updates the title; visible focus rings; 44 px touch targets; live announcements for answers and filter results; reduced motion respected.

## Project structure

```
server/
  index.ts        Express API: /api/health, /api/portfolio, /api/chat (streams tool steps, then the answer)
  agent.ts        Deterministic local demo engine: routing (situation → topic → composer)
  situation.ts    Reads a message into person, care state, treatment, hospital, bill
  confidence.ts   Claim-factor checks and the confidence rule
  scenarios.ts    Answer composers: headline, key points, confidence, details
  collector.ts    Records the real tool steps and assembles the answer
  tools.ts        The local policy tools
shared/
  demo.ts         Product name, demo date, active categories, data scoping
  types.ts        Shared data and answer types
src/
  App.tsx         Shell: header with pill navigation, phone pill nav, theme, assistant routing
  screens.tsx     Overview dashboard, Policies (+ policy detail), Claims, Documents
  Assistant.tsx   Assistant page (phone: full-screen view) — one card per answer; sources in the desktop rail
  ui.tsx          Ditto logo and mascot, status badges, cards (on shadcn Card), theme toggle, overlay focus
  components/ui/  shadcn/ui components (Button, Card, Table, Badge, Sheet, Accordion, ToggleGroup, …)
  format.ts       Formatting helpers and the chat API client
  prompts.ts      Curated prompts used by tiles and shortcuts
  index.css       Design tokens, light/dark themes, fonts, motion
docs/
  answer-scenarios.md  Scenario matrix, confidence rule, factor list
scripts/
  check-engine.ts     Engine regression check (answer contract + snapshot)
  engine-cases.json   Prompts it runs
  engine-snapshot.json  Expected answers
```

### Credits

Inter typeface by Rasmus Andersson, licensed under the SIL Open Font License 1.1 (subset WOFF2 files in `public/fonts`). Icons from Lucide (ISC licence).

### Changing the engine

Run `npm run check:engine` after any change to `server/` or `data/`. If an answer changes on purpose, run `npm run check:engine -- --update` and review the snapshot diff before committing.
