'use strict';

const { getTypeById } = require('../understand/story-types');
const { hasAnthropic } = require('../../integrations/anthropic');

// Dispatcher. Per-type modules own the script editorial.
// useAI=true routes to Claude with deterministic fallback on error.
async function generateScript(evidencePackage, audit, options = {}) {
  const type = getTypeById(evidencePackage.story_type);
  if (!type) {
    throw new Error(`Unknown story_type "${evidencePackage.story_type}"`);
  }

  const wantAI = Boolean(options.useAI) && typeof type.aiScript === 'function' && hasAnthropic();
  let script;
  let aiAttempted = false;
  let aiError = null;

  if (wantAI) {
    aiAttempted = true;
    try {
      script = await type.aiScript(evidencePackage, audit);
      try {
        validate(script);
      } catch (validationError) {
        aiError = `validation: ${validationError.message}`;
        script = null;
      }
    } catch (error) {
      aiError = error.message;
      script = null;
    }
  }

  if (!script) {
    script = type.script(evidencePackage, audit);
    validate(script);
  }

  return {
    ...script,
    story_type: evidencePackage.story_type,
    ai_attempted: aiAttempted,
    ai_error: aiError,
  };
}

const KNOWN_SEGMENT_ROLES = new Set([
  'hook', 'dossier', 'numbers', 'quote', 'map', 'charges', 'timeline', 'evidence_shelf', 'impact',
]);

function validate(script) {
  if (!script || typeof script.full_script !== 'string' || !script.full_script.trim()) {
    throw new Error('Script missing full_script');
  }
  if (!Array.isArray(script.segments) || script.segments.length < 3) {
    throw new Error('Script must include at least 3 module segments');
  }

  const seenRoles = new Set();
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    if (!seg || typeof seg !== 'object') {
      throw new Error(`Segment ${i} is not an object`);
    }
    if (typeof seg.role !== 'string' || !KNOWN_SEGMENT_ROLES.has(seg.role)) {
      throw new Error(`Segment ${i} has invalid role: ${JSON.stringify(seg.role)}`);
    }
    if (seenRoles.has(seg.role)) {
      throw new Error(`Segment ${i} duplicates role "${seg.role}"`);
    }
    seenRoles.add(seg.role);
    if (typeof seg.text !== 'string' || !seg.text.trim()) {
      throw new Error(`Segment "${seg.role}" has empty or non-string text`);
    }
  }

  // Audio/visual sync guard: rebuild full_script from segments in canonical
  // order. Claude sometimes shuffles full_script vs segments, which makes
  // plan-modules' voice alignment start later modules at earlier audio
  // positions — viewer hears segment N while seeing segment N+1's visuals.
  // Canonicalising guarantees A/V sync regardless of model behaviour.
  script.full_script = script.segments.map((s) => String(s.text).trim()).join(' ');

  const wordCount = script.full_script.split(/\s+/).filter(Boolean).length;
  if (wordCount < 12 || wordCount > 220) {
    throw new Error(`Script word count ${wordCount} outside (12, 220)`);
  }
}

module.exports = {
  generateScript,
};
