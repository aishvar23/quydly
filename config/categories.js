const CATEGORIES = [
  { id: "world",         label: "World News",    emoji: "🌍", newsDataTag: "world"         },
  { id: "politics",      label: "Politics",      emoji: "🏛️", newsDataTag: "politics"      },
  { id: "sports",        label: "Sports",        emoji: "🏆", newsDataTag: "sports"        },
  { id: "business",      label: "Business",      emoji: "💼", newsDataTag: "business"      },
  { id: "entertainment", label: "Entertainment", emoji: "🎭", newsDataTag: "entertainment" },
  { id: "science",       label: "Science",       emoji: "⚡", newsDataTag: "science"       },
  { id: "technology",    label: "Technology",    emoji: "💻", newsDataTag: "technology"    },
];

// Headlines to fetch per category — large pool so the hard-news filter
// has enough material to reach the required question count.
// Each API call returns 10; pagination fills the rest automatically.
const FETCH_COUNTS = {
  world:         60,
  politics:      60,
  sports:        60,
  business:      60,
  entertainment: 30,
  science:       30,
  technology:    30,
};

// Questions required per category for the full daily pool (50 total across 10 sessions).
// Rotating slot distribution across 10 sessions:
//   entertainment → sessions 0,3,6,9 = 4
//   science       → sessions 1,4,7   = 3
//   technology    → sessions 2,5,8   = 3
const EDITORIAL_MIX = {
  world:          10,
  politics:       10,
  sports:         10,
  business:       10,
  entertainment:   4,
  science:         3,
  technology:      3,
};

// Per-session composition: 4 fixed slots + 1 rotating
// Fixed:   world(1) + politics(1) + sports(1) + business(1)
// Rotating: cycles entertainment → science → technology → repeat
const SESSION_FIXED    = { world: 1, politics: 1, sports: 1, business: 1 };
const SESSION_ROTATING = ["entertainment", "science", "technology"];
const SESSION_SIZE     = 5;
const TOTAL_SESSIONS   = 10;

export { CATEGORIES, FETCH_COUNTS, EDITORIAL_MIX, SESSION_FIXED, SESSION_ROTATING, SESSION_SIZE, TOTAL_SESSIONS };
