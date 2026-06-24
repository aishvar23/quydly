// club-colors.js — curated team → accent color map for the football carousel.
//
// football-data.org does NOT reliably expose team colors, so we keep our own
// curated map for the clubs/national teams that appear in the ~12 free-tier
// competitions. `teamAccent(name)` is best-effort: a confident match returns the
// club's primary hex; anything unknown returns the neutral fallback so the
// renderer always has a usable accent (never throws, never empty).
//
// Colors are the dominant brand/kit color, chosen for legibility as an accent
// sliver on the dark carousel canvas. Keep entries normalised-key indexed.

// Neutral accent when a team is unknown — a desaturated cyan that reads on dark.
export const NEUTRAL_ACCENT = "#38BDF8";

// Normalise a team name to a lookup key: lowercase, strip accents, drop common
// club suffixes/prefixes and punctuation, collapse whitespace. Mirrors the
// resolver's normalisation so the same string resolves in both places.
export function normalizeTeamKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(fc|afc|cf|sc|ss|ssc|as|ac|rc|cd|ud|club|de|futbol|football)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// key (normalised) → primary accent hex. Aliases share a color via multiple keys.
const CLUB_COLORS = {
  // Premier League
  "arsenal": "#EF0107",
  "aston villa": "#670E36",
  "bournemouth": "#DA291C",
  "brentford": "#E30613",
  "brighton and hove albion": "#0057B8",
  "brighton": "#0057B8",
  "chelsea": "#034694",
  "crystal palace": "#1B458F",
  "everton": "#003399",
  "fulham": "#CC0000",
  "ipswich town": "#3A64A3",
  "leicester city": "#003090",
  "liverpool": "#C8102E",
  "manchester city": "#6CABDD",
  "manchester united": "#DA291C",
  "newcastle united": "#241F20",
  "nottingham forest": "#DD0000",
  "southampton": "#D71920",
  "tottenham hotspur": "#132257",
  "tottenham": "#132257",
  "west ham united": "#7A263A",
  "wolverhampton wanderers": "#FDB913",
  "wolverhampton": "#FDB913",
  // La Liga
  "real madrid": "#FEBE10",
  "barcelona": "#A50044",
  "atletico madrid": "#CB3524",
  "athletic bilbao": "#EE2523",
  "sevilla": "#D81920",
  "real sociedad": "#0067B1",
  "real betis": "#00954C",
  "villarreal": "#FFE667",
  "valencia": "#F1820A",
  // Serie A
  "juventus": "#000000",
  "inter": "#0068A8",
  "internazionale": "#0068A8",
  "milan": "#FB090B",
  "napoli": "#12A0D7",
  "roma": "#8E1F2F",
  "lazio": "#87D8F7",
  "atalanta": "#1E71B8",
  "fiorentina": "#592C82",
  // Bundesliga
  "bayern munchen": "#DC052D",
  "bayern munich": "#DC052D",
  "borussia dortmund": "#FDE100",
  "rb leipzig": "#DD0741",
  "bayer leverkusen": "#E32219",
  "bayer 04 leverkusen": "#E32219",
  "borussia monchengladbach": "#000000",
  "eintracht frankfurt": "#E1000F",
  // Ligue 1
  "paris saint germain": "#004170",
  "psg": "#004170",
  "marseille": "#2FAEE0",
  "olympique marseille": "#2FAEE0",
  "lyon": "#1B4DA1",
  "olympique lyonnais": "#1B4DA1",
  "monaco": "#E63312",
  "lille": "#E01E13",
  // Eredivisie / Primeira / Brazil (selective)
  "ajax": "#D2122E",
  "psv": "#ED1C24",
  "psv eindhoven": "#ED1C24",
  "feyenoord": "#E30613",
  "benfica": "#E40521",
  "porto": "#00428C",
  "sporting cp": "#008057",
  "sporting": "#008057",
  "flamengo": "#C52613",
  "palmeiras": "#006437",
  // National teams (World Cup / Euros)
  "brazil": "#FEDD00",
  "argentina": "#75AADB",
  "france": "#21304F",
  "england": "#CF081F",
  "spain": "#C60B1E",
  "germany": "#000000",
  "portugal": "#006600",
  "netherlands": "#FF6200",
  "italy": "#0066A1",
  "belgium": "#E30613",
};

// Best-effort accent lookup. Returns a confident club color or NEUTRAL_ACCENT.
export function teamAccent(name) {
  const key = normalizeTeamKey(name);
  if (!key) return NEUTRAL_ACCENT;
  if (CLUB_COLORS[key]) return CLUB_COLORS[key];
  // Fall back to a containment match (e.g. "manchester united fc women" → "manchester united").
  for (const [k, color] of Object.entries(CLUB_COLORS)) {
    if (key === k) return color;
    if (key.includes(k) && k.length >= 5) return color;
  }
  return NEUTRAL_ACCENT;
}

export const _CLUB_COLORS = CLUB_COLORS; // exported for tests
