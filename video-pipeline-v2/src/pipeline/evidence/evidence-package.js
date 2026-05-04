'use strict';

const { getTypeById } = require('../understand/story-types');

// Pure composer. Takes understanding + asks the type for asset declarations,
// safety notes, forbidden visuals. Returns the canonical evidence package.

function generateEvidencePackage(story, understanding, audit) {
  const type = getTypeById(understanding.story_type);
  if (!type) {
    throw new Error(`Unknown story_type "${understanding.story_type}"`);
  }

  const { assets, source_documents, safety_notes, forbidden_visuals } =
    type.evidenceAssets(understanding, story);

  return {
    story_id: story.id,
    story_type: understanding.story_type,
    audit: pickAudit(audit),
    entities: understanding.entities,
    numbers: understanding.numbers,
    legal: understanding.legal,
    timeline_events: understanding.timeline_events || [],
    visual_concepts: understanding.visualizable_concepts || [],
    source_documents: source_documents || story.source_documents || [],
    assets: assets || emptyAssets(),
    safety_notes: safety_notes || [],
    forbidden_visuals: forbidden_visuals || [],
    // Verbatim quote pulled from a source_document.quote_text. If null, the
    // QuoteCard module is skipped entirely — no auto-paraphrasing.
    verbatim_quote: understanding.verbatim_quote || null,
    // Generic pass-through for type-specific extras (e.g. detected_action).
    metadata: understanding.metadata || {},
  };
}

function pickAudit(audit) {
  if (!audit) return null;
  return {
    video_candidate: audit.video_candidate,
    video_candidate_score: audit.video_candidate_score,
    visual_angle: audit.visual_angle,
  };
}

function emptyAssets() {
  return {
    exact_available: [],
    contextual_available: [],
    maps_needed: [],
    graphics_needed: [],
  };
}

module.exports = {
  generateEvidencePackage,
};
