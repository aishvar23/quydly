'use strict';

// Cost gate for the video / POC pipelines.
//
// Six standalone video pipelines live in this repo (video-pipeline,
// video-pipeline-v2, evidence-first-video-pipeline, animated-video-pipeline,
// animated-video-pipeline-v1, poc-video-story-288). Every one of them read
// ANTHROPIC_API_KEY directly — the same key the production news pipeline bills
// against — and poc-video-story-288 runs claude-opus-4-7 ($5/$25 per MTok,
// ~1.7x Sonnet) with no cap. A hand-run experiment loop was therefore
// indistinguishable from production spend on the Anthropic usage dashboard,
// which is exactly what made the 2026-08-11 "where did $13 go?" investigation
// take an afternoon instead of ten seconds.
//
// The gate: these pipelines now want their OWN key.
//
//   ANTHROPIC_API_KEY_VIDEO=sk-ant-...   → used, and video spend is separable
//                                          on the dashboard by key.
//   VIDEO_ALLOW_SHARED_KEY=1             → escape hatch: fall back to the
//                                          shared ANTHROPIC_API_KEY, with a
//                                          warning on every run so it can't
//                                          quietly become the norm again.
//   neither                              → no key resolves. Callers that treat
//                                          "no key" as "skip AI" degrade
//                                          gracefully; callers that require it
//                                          fail with the message below.
//
// This is a spend-attribution boundary, not a security one — anyone who can
// run the pipeline can read both env vars.

const DEDICATED_VAR = 'ANTHROPIC_API_KEY_VIDEO';
const SHARED_VAR    = 'ANTHROPIC_API_KEY';
const OVERRIDE_VAR  = 'VIDEO_ALLOW_SHARED_KEY';

// Warn once per process, not once per call — these pipelines make many calls
// per run and a per-call warning would just train people to ignore it.
const warned = new Set();

function isTruthy(v) {
  return typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Resolve the Anthropic key a video pipeline should bill against.
 * @param {string} pipeline  pipeline name, for the warning/error text
 * @returns {string|null}    the key, or null when the gate is closed
 */
function resolveVideoAnthropicKey(pipeline = 'video-pipeline') {
  const dedicated = process.env[DEDICATED_VAR];
  if (isTruthy(dedicated)) return dedicated;

  const shared = process.env[SHARED_VAR];
  if (isTruthy(shared) && isTruthy(process.env[OVERRIDE_VAR])) {
    if (!warned.has(pipeline)) {
      warned.add(pipeline);
      console.warn(
        `[${pipeline}] WARNING: billing Anthropic usage to the SHARED ${SHARED_VAR} ` +
        `(${OVERRIDE_VAR} is set). This spend is indistinguishable from the production ` +
        `news pipeline on the usage dashboard. Set ${DEDICATED_VAR} to separate it.`,
      );
    }
    return shared;
  }

  return null;
}

/** True when a key resolves. Callers that treat AI as optional gate on this. */
function hasVideoAnthropicKey() {
  return resolveVideoAnthropicKey() !== null;
}

/** Resolve or throw, with the remediation spelled out. */
function requireVideoAnthropicKey(pipeline = 'video-pipeline') {
  const key = resolveVideoAnthropicKey(pipeline);
  if (key) return key;
  throw new Error(
    `[${pipeline}] No Anthropic key available. The video pipelines are gated behind ` +
    `their own key so their spend is separable from the production news pipeline.\n` +
    `  Set ${DEDICATED_VAR}=sk-ant-...  (preferred), or\n` +
    `  set ${OVERRIDE_VAR}=1 to bill the shared ${SHARED_VAR} anyway.`,
  );
}

module.exports = {
  resolveVideoAnthropicKey,
  hasVideoAnthropicKey,
  requireVideoAnthropicKey,
  DEDICATED_VAR,
  SHARED_VAR,
  OVERRIDE_VAR,
};
