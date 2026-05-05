'use strict';

// Bridge phase 1 — angle derivation.
//
// Replaces the old "primary_geos[0] vs primary_geos[1]" template with a
// synth-aware derivation that prefers the highest-level conflict frame
// over a side-effect frame.
//
// Story 170 (Iran/Hormuz) is the canonical motivating case: primary_geos
// is ["ir", "in"] because Iran is the subject and India is incidentally
// involved (Indian-flagged ships were attacked). The old template treated
// that as "Iran vs India" — wrong. The actual conflict is US ↔ Iran;
// India is an affected party, not a counterparty.
//
// Inputs (all from the Supabase row, post-bridge-phase-1 SELECT):
//   - headline                       — synth narrative.headline
//   - hook_sentence                  — P1-2 spoken-word hook
//   - why_it_matters                 — P1-7 stakes line
//   - primary_entities               — P3-5 clean text[] of names
//   - primary_entities_enriched      — P1-4 + P0-4 [{name,type,role,...}]
//   - primary_places                 — P0-3 [{code,name}]
//   - source_documents               — P0-1 snapshot for provenance
//
// Output (the angle object phase 2 will store as video_brief.angle):
//   {
//     primary_actors:   string[],   // who's in conflict (orgs/agencies/persons)
//     affected_parties: string[],   // sides caught in the fallout
//     places:           string[],   // proper-cased place names
//     hook:             string,     // spoken hook (synth's, not headline)
//     why:              string,     // stakes line
//     frame:            string,     // editor-readable conflict frame
//     posture:          string,     // editorial_posture or null
//   }

const PERSON_ROLE_HINTS = [
  'president', 'minister', 'secretary', 'judge', 'chief', 'leader',
  'speaker', 'envoy', 'ambassador', 'commander', 'general', 'field marshal',
  'defendant', 'prosecutor', 'witness', 'sailor', 'pilot',
];

const ORG_ROLE_HINTS_ACTOR = [
  // Roles that imply this entity is a primary actor (not a passive party).
  'subject', 'prosecutor', 'plaintiff', 'defendant', 'agency',
  'department', 'ministry', 'military', 'navy', 'army', 'force',
  'imposes', 'imposing', 'enforces', 'enforcing',
  'closing', 'announces', 'announcing', 'sanctioning',
];

function isPlaceEntity(e) {
  return e?.type === 'place';
}
function isPersonEntity(e) {
  return e?.type === 'person';
}
function isOrgEntity(e) {
  return e?.type === 'org';
}

// "Donald Trump escalating Iran tensions" → role implies actor on US side.
// "country protesting ship attacks" → role implies passive / affected.
function roleSuggestsAffected(role) {
  if (typeof role !== 'string') return false;
  const lower = role.toLowerCase();
  return /protest|caught|affected|fallout|victim|injured|attacked/.test(lower);
}

function roleSuggestsActor(role) {
  if (typeof role !== 'string') return false;
  const lower = role.toLowerCase();
  return ORG_ROLE_HINTS_ACTOR.some((kw) => lower.includes(kw))
    || PERSON_ROLE_HINTS.some((kw) => lower.includes(kw))
    || /escalat|launch|impos|enforc|sign|announc|sanction|veto|approve|seiz|attack|strike|block|warn/.test(lower);
}

// Heuristic: pull country names mentioned in a free-text sentence by
// matching against the primary_places list. Used to fill in actors that
// the entity-tag list missed (e.g. "United States" referenced in
// hook_sentence but no enriched-entity entry).
function placesMentionedInText(text, places) {
  if (typeof text !== 'string' || !text || !Array.isArray(places)) return [];
  const lower = text.toLowerCase();
  const out = [];
  for (const p of places) {
    if (!p?.name) continue;
    if (lower.includes(p.name.toLowerCase())) out.push(p.name);
  }
  return out;
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function deriveAngle(story) {
  const enriched = Array.isArray(story?.primary_entities_enriched)
    ? story.primary_entities_enriched
    : [];
  const places = Array.isArray(story?.primary_places) ? story.primary_places : [];
  const hookText = typeof story?.hook_sentence === 'string' && story.hook_sentence.trim()
    ? story.hook_sentence.trim()
    : (story?.headline || '');
  const whyText = typeof story?.why_it_matters === 'string' && story.why_it_matters.trim()
    ? story.why_it_matters.trim()
    : null;
  const posture = story?.editorial_posture ?? null;

  // Score each enriched entity for "actor" vs "affected" vs "background"
  // based on its role. Persons + orgs with active-verb roles → actor.
  // Places with passive roles (caught, protesting) → affected. Everything
  // else stays background.
  const actorEntities = [];
  const affectedEntities = [];
  for (const e of enriched) {
    if (!e?.name) continue;
    if (isPlaceEntity(e)) {
      if (roleSuggestsAffected(e.role)) affectedEntities.push(e.name);
      // Place that's not explicitly affected stays as a place anchor,
      // not an actor.
      continue;
    }
    if (isPersonEntity(e) || isOrgEntity(e)) {
      if (roleSuggestsActor(e.role)) actorEntities.push(e.name);
    }
  }

  // Augment actors with countries mentioned in the spoken hook that
  // don't appear as enriched entities. Catches the story-170 case where
  // "United States" is in the hook but only "Donald Trump" made the
  // primary_entities_enriched cut.
  const actorPlacesFromHook = placesMentionedInText(hookText, places);
  // Discard any of those that are already in `affectedEntities` — a
  // country can't simultaneously be the actor and the affected party.
  const affectedSet = new Set(affectedEntities.map((s) => s.toLowerCase()));
  const hookActorPlaces = actorPlacesFromHook.filter(
    (p) => !affectedSet.has(p.toLowerCase()),
  );

  const primary_actors = uniq([...actorEntities, ...hookActorPlaces]);
  const affected_parties = uniq(affectedEntities);
  const places_list = uniq(places.map((p) => p?.name).filter(Boolean));

  // Build the editor-readable frame. Highest-level conflict first;
  // affected parties as a secondary clause if any.
  let frame = '';
  if (primary_actors.length >= 2) {
    frame = `${primary_actors[0]} ↔ ${primary_actors[1]}`;
  } else if (primary_actors.length === 1 && places_list[0]) {
    frame = `${primary_actors[0]} action in ${places_list[0]}`;
  } else if (places_list[0]) {
    frame = places_list[0];
  } else {
    frame = story?.headline || 'Story';
  }
  if (affected_parties.length > 0) {
    frame += `; ${affected_parties.slice(0, 2).join(' and ')} affected`;
  }

  return {
    primary_actors,
    affected_parties,
    places: places_list,
    hook: hookText,
    why: whyText,
    frame,
    posture,
  };
}

module.exports = { deriveAngle };
