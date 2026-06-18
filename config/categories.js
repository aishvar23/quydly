const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
  { id: "ai",      label: "AI",      emoji: "🤖", newsDataTag: "technology"    },
];

// All six categories participate so per-beat serving has content for every
// selectable category (incl. science). The total daily question budget is
// SESSION_SIZE * TOTAL_SESSIONS (independent of the mix width) — widening the
// mix redistributes that budget across categories, it does not add questions.
const EDITORIAL_MIX = { world: 1, tech: 1, finance: 1, culture: 1, science: 1, ai: 1 };

const SESSION_SIZE   = 5;
const TOTAL_SESSIONS = 10;

export { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS };
