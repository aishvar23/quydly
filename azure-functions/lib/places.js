// Place resolver — country-code → readable proper-case name.
//
// P0-3 of the data-pipeline-improvements-tracker. Today the synthesizer stores
// `primary_geos = ["us"]` and the video pipeline has to translate via a
// hand-curated map. Storing the readable form alongside the code lets MapCallout
// and place-photo lookups skip the translation step.
//
// Mirrors the lookup table in `video-pipeline-v2/src/integrations/supabase.js`
// so a code present there is also readable here. Add countries as the corpus
// surfaces them.
//
// Future work (deliberately out of scope for this first cut): admin-level and
// lat/lon enrichment via Mapbox forward-geocoding or a richer gazetteer. The
// `primary_places` jsonb column is structured to accept those fields without
// another migration — `{ code, name, admin?, lat?, lon? }`.

export const COUNTRY_CODE_TO_NAME = {
  in: "India",
  pk: "Pakistan",
  bd: "Bangladesh",
  lk: "Sri Lanka",
  np: "Nepal",
  cn: "China",
  jp: "Japan",
  kr: "South Korea",
  kp: "North Korea",
  tw: "Taiwan",
  hk: "Hong Kong",
  sg: "Singapore",
  my: "Malaysia",
  id: "Indonesia",
  ph: "Philippines",
  th: "Thailand",
  vn: "Vietnam",
  us: "United States",
  ca: "Canada",
  mx: "Mexico",
  br: "Brazil",
  ar: "Argentina",
  ve: "Venezuela",
  co: "Colombia",
  cl: "Chile",
  pe: "Peru",
  gb: "United Kingdom",
  uk: "United Kingdom",
  ie: "Ireland",
  fr: "France",
  de: "Germany",
  it: "Italy",
  es: "Spain",
  pt: "Portugal",
  nl: "Netherlands",
  be: "Belgium",
  ch: "Switzerland",
  at: "Austria",
  pl: "Poland",
  se: "Sweden",
  no: "Norway",
  dk: "Denmark",
  fi: "Finland",
  is: "Iceland",
  gr: "Greece",
  tr: "Turkey",
  ru: "Russia",
  ua: "Ukraine",
  by: "Belarus",
  ro: "Romania",
  cz: "Czech Republic",
  hu: "Hungary",
  il: "Israel",
  ps: "Palestinian Territories",
  ir: "Iran",
  sa: "Saudi Arabia",
  ae: "United Arab Emirates",
  qa: "Qatar",
  eg: "Egypt",
  za: "South Africa",
  ng: "Nigeria",
  ke: "Kenya",
  et: "Ethiopia",
  au: "Australia",
  nz: "New Zealand",
};

export function countryCodeToName(code) {
  if (!code || typeof code !== "string") return null;
  return COUNTRY_CODE_TO_NAME[code.trim().toLowerCase()] ?? null;
}

// Build the `primary_places` jsonb payload from a cluster's primary_geos.
// Unknown codes pass through with name=null so the video pipeline can still
// see the code and decide whether to fall back to its own resolver — better
// than dropping the entry entirely.
export function resolvePrimaryPlaces(primaryGeos) {
  const codes = Array.isArray(primaryGeos) ? primaryGeos : [];
  return codes.map(code => ({
    code: String(code).trim().toLowerCase(),
    name: countryCodeToName(code),
  }));
}
