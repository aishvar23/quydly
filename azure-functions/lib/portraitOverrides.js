// P2-5 — entity portrait override lookup.
//
// Editor-maintained table `entity_portrait_overrides` lets us replace
// Wikipedia's default lead image with a curated press photo for prominent
// figures. The synthesizer's attachWikipediaToEntities calls
// `lookupPortraitOverrides` BEFORE the Wikipedia probe; entities with a
// matching override skip the probe and get the override's portrait fields.
//
// Lookup is case-insensitive on a normalised key. Editor stores names in
// any casing they prefer in `display_name`; the lookup column
// `entity_name_norm` is the lowercased+trimmed match key.
//
// Failure mode: any error returns an empty Map so synthesis falls back to
// the existing Wikipedia path. Override fetch is non-essential.

/**
 * Normalise an entity name for override lookup. Mirrors the SQL key:
 * lowercased, whitespace-collapsed, trimmed.
 */
export function normaliseOverrideKey(name) {
  if (typeof name !== "string") return "";
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Batch-lookup overrides for a list of entity names. Returns a Map keyed
 * by the *original* (un-normalised) name so callers can match without
 * re-normalising.
 *
 * @param {SupabaseClient} supabase
 * @param {string[]} names
 * @returns {Promise<Map<string, OverrideRow>>}
 */
export async function lookupPortraitOverrides(supabase, names) {
  const result = new Map();
  if (!Array.isArray(names) || names.length === 0) return result;

  // Build normalised key set, but remember each original name so we can
  // map results back. Multiple originals may share a normalised key
  // ("Donald Trump", "donald trump", "DONALD TRUMP" → all "donald trump").
  const norms = new Set();
  const originalsByNorm = new Map();
  for (const n of names) {
    const norm = normaliseOverrideKey(n);
    if (!norm) continue;
    norms.add(norm);
    if (!originalsByNorm.has(norm)) originalsByNorm.set(norm, []);
    originalsByNorm.get(norm).push(n);
  }
  if (norms.size === 0) return result;

  let rows;
  try {
    const { data, error } = await supabase
      .from("entity_portrait_overrides")
      .select("entity_name_norm, display_name, image_url, thumbnail_url, attribution, license")
      .in("entity_name_norm", [...norms]);
    if (error) return result;
    rows = data ?? [];
  } catch {
    // Table missing in test envs / network blip — degrade gracefully.
    return result;
  }

  for (const row of rows) {
    if (!row?.entity_name_norm) continue;
    const originals = originalsByNorm.get(row.entity_name_norm) ?? [];
    for (const orig of originals) {
      result.set(orig, row);
    }
  }
  return result;
}
