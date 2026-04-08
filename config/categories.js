const CATEGORIES = [
  { id: "world",   label: "World",   emoji: "🌍", newsDataTag: "world"         },
  { id: "tech",    label: "Tech",    emoji: "💻", newsDataTag: "technology"    },
  { id: "finance", label: "Finance", emoji: "💰", newsDataTag: "business"      },
  { id: "culture", label: "Culture", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science", label: "Science", emoji: "⚡", newsDataTag: "science"       },
];

const EDITORIAL_MIX = { world: 2, tech: 1, finance: 1, culture: 1 };

const SESSION_SIZE   = 5;
const TOTAL_SESSIONS = 10;

export { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS };
