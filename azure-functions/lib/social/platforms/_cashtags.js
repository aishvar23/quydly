// Cashtag derivation for X posts. Design §8.1 (reach).
//
// X cashtags ($AAPL) are clickable and feed X's per-ticker pages, so they aid
// discovery on finance stories without the spam penalty hashtags carry. We emit
// them ONLY for finance-category stories, ONLY for organisations we can map to a
// real ticker via a curated static table, and we skip silently when unknown — a
// wrong cashtag points readers at the wrong stock, which is worse than none.
//
//   cashtagsFor(story, { max }) → ["$AAPL", "$MSFT"]
//
// The map is intentionally conservative (well-known, unambiguous large caps).
// Source of names: stories.primary_entities_enriched (typed) + primary_entities.

import { entityNames } from "./_shared.js";

// Normalised org name → ticker. Keys are the output of normaliseOrg().
const ORG_TO_TICKER = {
  // Mega-cap tech
  apple: "AAPL",
  microsoft: "MSFT",
  amazon: "AMZN",
  alphabet: "GOOGL",
  google: "GOOGL",
  meta: "META",
  "meta platforms": "META",
  facebook: "META",
  nvidia: "NVDA",
  tesla: "TSLA",
  netflix: "NFLX",
  oracle: "ORCL",
  salesforce: "CRM",
  adobe: "ADBE",
  intel: "INTC",
  amd: "AMD",
  "advanced micro devices": "AMD",
  qualcomm: "QCOM",
  broadcom: "AVGO",
  cisco: "CSCO",
  ibm: "IBM",
  "palo alto networks": "PANW",
  servicenow: "NOW",
  snowflake: "SNOW",
  palantir: "PLTR",
  uber: "UBER",
  lyft: "LYFT",
  airbnb: "ABNB",
  "doordash": "DASH",
  shopify: "SHOP",
  spotify: "SPOT",
  snap: "SNAP",
  pinterest: "PINS",
  reddit: "RDDT",
  roblox: "RBLX",
  coinbase: "COIN",
  block: "SQ",
  square: "SQ",
  paypal: "PYPL",
  arm: "ARM",
  "arm holdings": "ARM",
  dell: "DELL",
  "hewlett packard": "HPQ",
  hp: "HPQ",
  "texas instruments": "TXN",
  "micron": "MU",
  "applied materials": "AMAT",
  "super micro": "SMCI",
  "super micro computer": "SMCI",
  zoom: "ZM",

  // Autos / industrials
  ford: "F",
  "general motors": "GM",
  gm: "GM",
  rivian: "RIVN",
  lucid: "LCID",
  boeing: "BA",
  "general electric": "GE",
  ge: "GE",
  caterpillar: "CAT",
  "3m": "MMM",
  honeywell: "HON",
  "lockheed martin": "LMT",
  "raytheon": "RTX",
  rtx: "RTX",
  deere: "DE",
  "john deere": "DE",

  // Finance
  "jpmorgan": "JPM",
  "jpmorgan chase": "JPM",
  "jp morgan": "JPM",
  "goldman sachs": "GS",
  "morgan stanley": "MS",
  "bank of america": "BAC",
  citigroup: "C",
  citi: "C",
  "wells fargo": "WFC",
  "american express": "AXP",
  visa: "V",
  mastercard: "MA",
  blackrock: "BLK",
  "charles schwab": "SCHW",
  "berkshire hathaway": "BRK.B",

  // Consumer / retail / staples
  walmart: "WMT",
  target: "TGT",
  costco: "COST",
  "home depot": "HD",
  lowes: "LOW",
  nike: "NKE",
  starbucks: "SBUX",
  "mcdonalds": "MCD",
  "coca cola": "KO",
  "coca-cola": "KO",
  pepsico: "PEP",
  pepsi: "PEP",
  "procter gamble": "PG",
  "procter & gamble": "PG",
  disney: "DIS",
  "walt disney": "DIS",
  "comcast": "CMCSA",
  "warner bros discovery": "WBD",
  "warner bros": "WBD",
  paramount: "PARA",

  // Energy / health / telecom
  exxon: "XOM",
  "exxon mobil": "XOM",
  "exxonmobil": "XOM",
  chevron: "CVX",
  "conocophillips": "COP",
  shell: "SHEL",
  bp: "BP",
  "johnson & johnson": "JNJ",
  "johnson and johnson": "JNJ",
  pfizer: "PFE",
  moderna: "MRNA",
  merck: "MRK",
  "eli lilly": "LLY",
  "novo nordisk": "NVO",
  "unitedhealth": "UNH",
  "unitedhealth group": "UNH",
  "at&t": "T",
  att: "T",
  verizon: "VZ",
  "t-mobile": "TMUS",
  "t mobile": "TMUS",

  // Non-US notables commonly quoted on US ADRs
  tsmc: "TSM",
  "taiwan semiconductor": "TSM",
  alibaba: "BABA",
  "asml": "ASML",
  sap: "SAP",
  toyota: "TM",
};

// Reduce a raw entity name to a lookup key: lowercase, drop corporate suffixes,
// strip punctuation, collapse whitespace. Keeps "&"/"-" only where the map uses
// them (handled by trying both the stripped and lightly-cleaned forms).
function normaliseOrg(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|holdings|group|sa|nv|ag|the)\b/g, " ")
    .replace(/[^a-z0-9&\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tickerFor(name) {
  const key = normaliseOrg(name);
  if (!key) return null;
  if (ORG_TO_TICKER[key]) return ORG_TO_TICKER[key];
  // Try an ampersand/hyphen-normalised variant ("procter and gamble").
  const alt = key.replace(/\s*&\s*/g, " & ").replace(/\s+/g, " ").trim();
  return ORG_TO_TICKER[alt] || null;
}

// Cashtags for a story, in entity order, deduped, capped. Empty unless the story
// is finance-category and at least one org maps to a known ticker. Only org-typed
// (and legacy untyped) entities are considered — membership in the ticker map
// implies the name is a tradable company, so flat names are safe to look up too.
export function cashtagsFor(story, { max = 2 } = {}) {
  if (!story || story.category_id !== "finance") return [];
  const seen = new Set();
  const out = [];
  for (const name of entityNames(story, ["org"])) {
    const ticker = tickerFor(name);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(`$${ticker}`);
    if (out.length >= max) break;
  }
  return out;
}

export { ORG_TO_TICKER, normaliseOrg, tickerFor };
