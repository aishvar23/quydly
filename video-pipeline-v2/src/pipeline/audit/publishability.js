'use strict';

// Bridge phase 1 — publishability gate.
//
// The existing video-candidate-audit.js scores stories on visual signal
// + confidence + coherence — useful, but it doesn't enforce editorial
// safety rules (verification, consistency, source diversity, factual
// conflicts). Codex's plan calls for those rules at brief time.
//
// This gate is INFORMATIVE, not destructive. It returns:
//   {
//     publishable: bool,
//     publish_block_reason: string | null,  // first failing rule
//     risk_label: 'verified' | 'developing' | 'unverified',
//     blocks: string[],                      // every failing rule
//   }
//
// The orchestrator uses this in two ways:
//   1. Tag the rendered MP4 with "DEVELOPING" / "UNVERIFIED" when not
//      publishable (instead of presenting it as a polished render).
//   2. Surface to editor tooling so the operator sees WHY a story was
//      gated, not just that it was.
//
// Rules:
//   - verification_status !== 'verified' → unverified
//   - is_verified !== true (legacy fallback)
//   - consistency_score < CONSISTENCY_FLOOR (0.75)
//   - source_count < SOURCE_FLOOR (2)
//   - factual_conflicts.length > 0
//
// First-match wins on `publish_block_reason` so the editor sees the
// most-specific reason; `blocks` lists every fail for full visibility.

const CONSISTENCY_FLOOR = 0.75;
const SOURCE_FLOOR = 2;

function computePublishability(story) {
  const blocks = [];

  // Verification — primary gate. Use verification_status (P1-9, the
  // explicit lifecycle field) as the source of truth. is_verified is a
  // legacy boolean kept for back-compat; both are checked because the
  // migration's backfill mapped is_verified=true → status='verified',
  // so they should normally agree.
  const verifStatus = typeof story?.verification_status === 'string'
    ? story.verification_status
    : null;
  if (verifStatus !== 'verified') {
    blocks.push(`verification_status=${verifStatus ?? 'null'}`);
  } else if (story?.is_verified === false) {
    // Status says verified but legacy bool disagrees — treat as
    // unverified pending reconciliation.
    blocks.push('is_verified_false_despite_status');
  }

  // Consistency — synth's per-story consistency_score must clear the
  // floor. consistency_score is distinct from coherence_score; the
  // floor is set against the former.
  const consistency = Number(story?.consistency_score);
  if (!Number.isFinite(consistency) || consistency < CONSISTENCY_FLOOR) {
    blocks.push(`consistency_score=${Number.isFinite(consistency) ? consistency.toFixed(3) : 'null'}`);
  }

  // Source diversity — minimum 2 distinct sources. Prevents wire-only
  // single-pickup videos.
  const sourceCount = Number(story?.source_count);
  if (!Number.isFinite(sourceCount) || sourceCount < SOURCE_FLOOR) {
    blocks.push(`source_count=${Number.isFinite(sourceCount) ? sourceCount : 'null'}`);
  }

  // Factual conflicts — any unreconciled disagreement blocks publish.
  const conflicts = Array.isArray(story?.factual_conflicts)
    ? story.factual_conflicts
    : [];
  if (conflicts.length > 0) {
    blocks.push(`factual_conflicts=${conflicts.length}`);
  }

  const publishable = blocks.length === 0;
  const publish_block_reason = publishable ? null : blocks[0];

  // Risk label — drives the on-video badge. "developing" is reserved
  // for stories where the news is genuinely mid-event (synth's
  // editorial_posture flagged it as breaking_developing) AND the
  // unverified state is a function of the news cycle, not a quality
  // failure. Other failures land in "unverified".
  let risk_label;
  if (publishable) {
    risk_label = 'verified';
  } else if (story?.editorial_posture === 'breaking_developing') {
    risk_label = 'developing';
  } else {
    risk_label = 'unverified';
  }

  return {
    publishable,
    publish_block_reason,
    risk_label,
    blocks,
  };
}

module.exports = {
  computePublishability,
  CONSISTENCY_FLOOR,
  SOURCE_FLOOR,
};
