# Quydly — Claude Code Session File

> Pronunciation: "kwid-lee" | Domain: quydly.com

## What It Is
Finite daily news quiz. 5 questions, ~3 min, resets 7AM.
Wordle-style daily ritual. Wager points. TL;DR reveal after each answer.
Users feel informed, not tested.

## Stack
| Layer | Choice |
|---|---|
| Frontend | React Native (Expo) |
| Backend | Node.js + Express, deployed on Vercel |
| Database | Supabase (auth + persistence) |
| Cache | Redis (daily questions) |
| News | NewsData.io API |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Payments | Stripe (stub only — v2) |

## Repo Structure
```
quydly/
├── CLAUDE.md              ← this file (auto-read by Claude Code)
├── SPEC.md                ← full architecture detail
├── quydly.jsx             ← working web prototype — UX source of truth
├── config/
│   ├── flags.js           ← ALL feature flags (one place only)
│   └── categories.js      ← ALL category data (one place only)
├── frontend/              ← React Native (Expo)
│   └── screens/
│       ├── HomeScreen.jsx
│       ├── QuestionScreen.jsx
│       ├── RevealScreen.jsx
│       ├── GateScreen.jsx
│       └── EndScreen.jsx
└── backend/
    ├── index.js
    ├── routes/
    │   ├── questions.js   ← GET /api/questions
    │   └── complete.js    ← POST /api/complete
    ├── jobs/
    │   └── generateDaily.js  ← 7AM cron
    ├── services/
    │   ├── newsdata.js    ← NewsData.io client
    │   ├── claude.js      ← Claude API question generator
    │   └── stripe.js      ← STUB ONLY — do not implement
    └── db/
        └── schema.sql     ← Supabase schema
```

## Non-Negotiable Architecture Rules
1. **Config only** — never hardcode categories or mix in UI; always import from `config/`
2. **CreditManager is abstract** — `FreeCreditManager` implements it for pilot; `PremiumCreditManager` stubs for v2
3. **ContentStrategy is injected** — 3 implementations, switched via `FLAGS.activeStrategy`
4. **Question card is category-agnostic** — receives a question object, renders it, doesn't know how it was sourced
5. **One flags file** — `config/flags.js` is the only place feature flags live
6. **Stripe is a stub** — scaffold the webhook handler, leave implementation empty

## Key References
- Full architecture: `SPEC.md`
- UX reference: `quydly.jsx` — match this exactly in React Native
- Design tokens: `SPEC.md` → Design section

## Working Rules
- Ask before any architectural decision not covered in CLAUDE.md or SPEC.md
- Build one screen at a time; confirm before moving to next
- Scaffold full structure first, implement second
- Run `npm run lint` and fix all errors before marking any task done
- All env vars via `.env` — never hardcode keys
