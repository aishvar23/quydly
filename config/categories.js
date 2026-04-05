const CATEGORIES = [
  { id: "world",         label: "World News",    emoji: "🌍", newsDataTag: "top"           },
  { id: "tech",          label: "Technology",    emoji: "💻", newsDataTag: "technology"    },
  { id: "sports",        label: "Sports",        emoji: "🏆", newsDataTag: "sports"        },
  { id: "entertainment", label: "Entertainment", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science",       label: "Science",       emoji: "⚡", newsDataTag: "science"       },
  { id: "business",      label: "Business",      emoji: "💼", newsDataTag: "business"      },
];

// Full daily generation pool — 55 questions (5 leftover after 50 are delivered)
const EDITORIAL_MIX = {
  world:         20,
  tech:          10,
  sports:         5,
  entertainment:  5,
  science:        5,
  business:      10,
};

// Per-session composition: 2 world + 1 tech + 1 rotating + 1 business
// Rotating slot cycles through sports → entertainment → science across 10 sessions
const SESSION_FIXED = { world: 2, tech: 1, business: 1 };
const SESSION_ROTATING = ["sports", "entertainment", "science"];
const SESSION_SIZE = 5;
const TOTAL_SESSIONS = 10;

export { CATEGORIES, EDITORIAL_MIX, SESSION_FIXED, SESSION_ROTATING, SESSION_SIZE, TOTAL_SESSIONS };
