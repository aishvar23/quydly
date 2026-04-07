const CATEGORIES = [
  { id: "world",         label: "World News",    emoji: "🌍" },
  { id: "politics",      label: "Politics",      emoji: "🏛️" },
  { id: "sports",        label: "Sports",        emoji: "🏆" },
  { id: "business",      label: "Business",      emoji: "💼" },
  { id: "entertainment", label: "Entertainment", emoji: "🎭" },
  { id: "science",       label: "Science",       emoji: "⚡" },
  { id: "technology",    label: "Technology",    emoji: "💻" },
];

// Per-session composition
const SESSION_SIZE   = 5;
const TOTAL_SESSIONS = 10;

export { CATEGORIES, SESSION_SIZE, TOTAL_SESSIONS };
