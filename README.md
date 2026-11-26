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
| `npm run check:engine` | Runs 72 assistant prompts twice and compares them with the saved snapshot (see below) |

Shortcut for demos: `http://localhost:5173/?ask=Compare%20my%20health%20policies` opens the assistant with that question.

## How answers are produced

There is **no AI model** behind the assistant — not Gemini or any other provider. The hackathon prototype this grew from used the Gemini API; that integration, its SDK and its API key have been removed entirely.

Every answer comes from a **deterministic local engine** (`server/agent.ts`):

1. **Safety checks** — unreadable input, attempts to change the rules, abuse.
2. **Intent** — the question is matched by rules to one supported kind: emergency, compare, claim process, explain a policy detail, prepare, or coverage check. Questions about car, travel, home or personal accident insurance, purchases or recommendations, and non-insurance questions get an honest reply with suggested questions.
3. **Tools** — a fixed sequence of local tools runs against the sample data (`server/tools.ts`): `searchPolicies`, `retrievePolicyEvidence`, `evaluateCoverage`, `comparePolicies`, `calculatePotentialCost`, `generateActionPlan`. The "How this answer was built" list in each answer shows the actual steps that ran.
4. **Answer** — composed from the tool results with fixed templates, so the same question always gets the same answer.

Answer rules: coverage statements cite clauses; *Supported / Uncertain / Not found* are kept distinct from interpretation and unknowns; approval is never guaranteed; medical emergencies show "call 112" first; text in uploaded documents is treated as untrusted and any instructions in it are ignored.

The engine answers each question on its own (no memory of earlier messages) and recognises common phrasings rather than any wording — the curated prompts below are the reliable path.

### Curated demo questions

- My father has been admitted after a cardiac emergency. Which policy can help, and what should I do?
- Is maternity covered for my wife?
- Compare my health policies
- Who is the nominee on my term life policy, and what would my family receive?
- I have a planned surgery next month. How do I get cashless treatment?
- My son was discharged after a hospital stay. How do I file a reimbursement claim?
- How does my nominee make a claim on my term life policy?
- My father's hospital bill is ₹4 lakh for a cardiac procedure. How much will I pay?

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
  agent.ts        Deterministic local demo engine (intents → tools → templated answer)
  tools.ts        The six local policy tools
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
scripts/
  check-engine.ts     Engine regression check
  engine-cases.json   Prompts it runs
  engine-snapshot.json  Expected answers
```

### Credits

Inter typeface by Rasmus Andersson, licensed under the SIL Open Font License 1.1 (subset WOFF2 files in `public/fonts`). Icons from Lucide (ISC licence).

### Changing the engine

Run `npm run check:engine` after any change to `server/` or `data/`. If an answer changes on purpose, run `npm run check:engine -- --update` and review the snapshot diff before committing.
