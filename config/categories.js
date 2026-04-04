const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
];

// Full daily pool — 50 questions
const EDITORIAL_MIX = { world: 20, tech: 10, finance: 10, culture: 10 };

// Per-session breakdown — 5 questions, always this mix
const SESSION_MIX = { world: 2, tech: 1, finance: 1, culture: 1 };
const SESSION_SIZE = 5;
const TOTAL_SESSIONS = 10; // 50 total / 5 per session

export { CATEGORIES, EDITORIAL_MIX, SESSION_MIX, SESSION_SIZE, TOTAL_SESSIONS };
