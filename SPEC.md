# Quydly — Full Specification

> Read CLAUDE.md first. This file is the detail layer.

---

## Config Files

### config/flags.js
```js
const FLAGS = {
  activeStrategy:        "editorial", // "editorial" | "beat" | "custom"
  premiumEnabled:         false,       // flip to true in v2
  beatEnabled:            false,       // flip to true in v2
  customMixEnabled:       false,       // flip to true for Model C
  showStrategyHint:       true,        // show "My Beat coming in Premium" hint
  freeQuestionsPerDay:    5,
  premiumQuestionsPerDay: 10,
};
module.exports = FLAGS;
```

### config/categories.js
```js
const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
];

const EDITORIAL_MIX = { world: 2, tech: 1, finance: 1, culture: 1 };

module.exports = { CATEGORIES, EDITORIAL_MIX };
```

---

## Content Strategy Pattern

Three strategies, one interface. App always calls `strategy.getQuestions()` — never knows which is active.

```js
// Interface (implement all three)
ContentStrategy {
  getLabel()              // → string shown in UI header
  getCategoryMix()        // → { [categoryId]: count } — rendered on end screen
  isConfigurable()        // → bool — shows settings UI if true
  buildPromptCategories() // → Category[] — ordered list for question generation
}

// EditorialStrategy — ACTIVE FOR PILOT
// Mix is EDITORIAL_MIX from config. Fixed, not user-controlled.

// BeatStrategy(beat) — V2
// User picks one primary beat on onboarding. Mix skews 60% toward it.

// CustomStrategy(weights) — V2 PREMIUM
// User sets weights via sliders. isConfigurable() returns true.
// Settings screen renders only when isConfigurable() is true.
```

Switching models = change `FLAGS.activeStrategy`. Zero other code changes.

---

## Credit Manager Pattern

```js
// Interface
CreditManager {
  getTier()        // → "free" | "premium"
  getCreditsLeft() // → number
  canPlay()        // → boolean
  consumeCredit()  // → void
  resetDaily()     // → void — called by 7AM cron
}

// FreeCreditManager — PILOT
// dailyLimit: FLAGS.freeQuestionsPerDay (5)
// Persisted in Supabase per user per day

// PremiumCreditManager — V2 STUB
// dailyLimit: FLAGS.premiumQuestionsPerDay (10)
// Scaffold class, leave implementation empty
```

---

## Daily Question Pipeline

```
7:00 AM UTC — cron job fires (jobs/generateDaily.js)
      ↓
1. Read EDITORIAL_MIX from config
2. For each category in mix:
   a. Call NewsData.io: GET /api/1/news
      ?apikey={NEWSDATA_API_KEY}
      &language=en
      &category={newsDataTag}
      &timeframe=24
   b. Pick top headline (title + description)
3. Send each headline to Claude API (see prompt below)
4. Parse JSON response → validate shape
5. Cache array of 5 questions in Redis (key: "questions:{YYYY-MM-DD}")
   TTL: 24 hours
6. Fallback: if Redis unavailable, store in Supabase daily_questions table
```

### Claude Prompt (per question)
```
You are a witty news quiz writer for Quydly, a daily news game.

Generate ONE multiple-choice question about this real news story:
Title: {headline}
Summary: {description}

Rules:
- Punchy, witty, jargon-free — smart but not academic
- 4 options: exactly 1 correct, 3 plausible distractors
- TL;DR: exactly 2 sentences of story context

Respond ONLY with valid JSON, no markdown:
{
  "question": "string",
  "options": ["A","B","C","D"],
  "correctIndex": 0,
  "tldr": "Two sentence string.",
  "categoryId": "{categoryId}"
}
```

---

## API Routes

### GET /api/questions
Returns today's 5 questions.
- Check Redis cache first → return if hit
- If miss → check Supabase daily_questions → return if found
- If miss → trigger generation (fallback, shouldn't happen) → return
- Response: `{ date, questions: Question[], generatedAt }`

### POST /api/complete
Records a completed session.
- Body: `{ userId, score, results: [{correct, delta, categoryId}] }`
- Updates `completions` table
- Updates user streak logic (see Streak section)
- Response: `{ streak, totalPoints, rank }`

### POST /api/webhook/stripe — STUB
Scaffold only. Body: Stripe webhook event.
Log the event. Return 200. Do not implement.

---

## Supabase Schema

```sql
-- Users
create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  streak       int default 0,
  last_played  date,
  total_points int default 0,
  tier         text default 'free', -- 'free' | 'premium'
  created_at   timestamptz default now()
);

-- Daily questions cache (fallback if Redis unavailable)
create table daily_questions (
  date           date primary key,
  questions      jsonb not null,
  generated_at   timestamptz default now()
);

-- Completions
create table completions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id),
  date       date not null,
  score      int not null,
  results    jsonb not null,
  created_at timestamptz default now(),
  unique(user_id, date)
);
```

---

## Streak Logic

```js
function updateStreak(user, today) {
  const yesterday = subDays(today, 1);
  if (user.last_played === yesterday) return user.streak + 1; // continuing
  if (user.last_played === today)     return user.streak;     // already played
  return 1;                                                    // streak broken
}
```

---

## Scoring

```js
const delta = correct ? wager : -Math.floor(wager / 2);
// Wager options: 10 | 25 | 50 | 100
// Grade thresholds (session score / max possible):
// Ace           ≥ 85%  🏆
// Sharp         ≥ 65%  🎯
// Informed      ≥ 40%  📰
// Caught Slipping < 40% 🫠
```

### Share Card Format
```
Quydly — Edition #N
🏆 Ace | 340 pts
🟨⬛🟨🟨⬛
Beaten 73% of readers today
```
(🟨 = correct, ⬛ = wrong)

---

## Screens

All 5 screens are implemented in `quydly.jsx` — use as UX source of truth.

| Screen | Trigger | Key elements |
|---|---|---|
| Home | App open, credits > 0 | Streak badge, points, mix pills, Start button, credits note |
| Question | After Start | Topic tag, question, wager row, 4 answer buttons |
| Reveal | After answer | Points flash, TL;DR panel, Next/Results button |
| Gate | Credits = 0 | Countdown timer, "Come back tomorrow", locked Premium button |
| End | After Q5 | Grade, score, global rank, mix breakdown, share button, reset |

### Gate Screen — Premium Button
Always render it. In pilot: `disabled`, cursor `not-allowed`, label shows "COMING SOON".
In v2: flip `FLAGS.premiumEnabled = true` → button becomes active, links to Stripe checkout.

### End Screen — Strategy Hint
Render when `FLAGS.showStrategyHint === true`:
```
Want to tune your mix? My Beat is coming in Premium.
```

---

## Design Tokens

```js
const tokens = {
  ink:     "#0c0b09",  // background
  ink2:    "#161512",
  card:    "#1c1a17",  // card background
  card2:   "#242118",  // secondary card / inputs
  cream:   "#f2ead8",  // primary text
  cream2:  "#c8bfa8",  // secondary text
  amber:   "#e8a020",  // primary accent
  amber2:  "#f5b940",  // hover accent
  green:   "#3aaa72",  // correct answer
  red:     "#d94040",  // wrong answer
  muted:   "#6b6455",  // labels, disabled
  border:  "rgba(232,160,32,0.15)",
  border2: "rgba(232,160,32,0.30)",
};

const fonts = {
  display: "Playfair Display",  // headlines, question text
  mono:    "JetBrains Mono",    // scores, labels, data
  body:    "Lato",              // answer text, body copy
};
```

### Animations
- Card entry: slide up + scale from 0.96 → 1, 450ms cubic-bezier(0.34,1.56,0.64,1)
- Correct answer: pop (scale 1 → 1.04 → 1), 300ms
- Wrong answer: shake (translateX ±8px), 400ms
- Progress bar fill: width transition 700ms cubic-bezier(0.34,1.56,0.64,1)
- Grain texture: fixed SVG noise overlay, opacity 0.03

---

## Environment Variables

```
# .env
NEWSDATA_API_KEY=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
REDIS_URL=
STRIPE_SECRET_KEY=          # stub — not used in pilot
STRIPE_WEBHOOK_SECRET=      # stub — not used in pilot
CRON_SECRET=                # secures the cron endpoint
```

---

## V2 Checklist (do not build, just scaffold stubs)

- [ ] `PremiumCreditManager` class (empty)
- [ ] `BeatStrategy` fully implemented
- [ ] `CustomStrategy` fully implemented  
- [ ] Settings screen (renders when `strategy.isConfigurable()`)
- [ ] Stripe webhook handler (logs event, returns 200)
- [ ] `FLAGS.premiumEnabled` gate on Premium button
- [ ] User onboarding flow (beat selection)
