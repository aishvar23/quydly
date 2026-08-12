// `selectable: false` retires a category from every picker (beat chips etc.)
// while keeping its label/emoji so historical questions and shareable
// single-question pages still render. Never delete a retired entry — old
// quiz_questions / social_questions rows still carry its id.
const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  // Culture RETIRED (owner decision 2026-07-30: "no one is interested in
  // culture") — no feeds ingested, absent from EDITORIAL_MIX, hidden from
  // pickers. Rendering-only entry.
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment", selectable: false },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
  { id: "ai",      label: "AI",      emoji: "🤖", newsDataTag: "technology"    },
];

// Participating categories share the total daily question budget of
// SESSION_SIZE * TOTAL_SESSIONS (independent of the mix width) — widening the
// mix redistributes that budget across categories, it does not add questions.
// A category absent from this map gets ZERO daily questions (culture is
// deliberately absent — retired 2026-07-30).
const EDITORIAL_MIX = { world: 1, tech: 1, finance: 1, science: 1, ai: 1 };

const SESSION_SIZE   = 5;
const TOTAL_SESSIONS = 10;

export { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS };
