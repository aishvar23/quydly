'use strict';

const fs = require('fs');
const path = require('path');

// Walk the final story package and surface every silent-degradation path:
// synthetic voice timing (TTS unavailable), asset fallbacks (Mapbox down,
// token missing, location off-gazetteer), AI-script fallbacks. Writes a
// fallback-report.json artifact and returns a console-friendly summary.

function buildFallbackReport(storyPackage) {
  const items = [];

  // Voice — synthetic char-level timing means no real TTS audio.
  // forcedSynthetic (from --dry-run-fallbacks) is intentional, not a degradation.
  if (storyPackage.voice?.isTimingOnly && !storyPackage.voice?.forcedSynthetic) {
    const reason = storyPackage.voice?.failureReason || 'synthetic_timing';
    const hint = storyPackage.voice?.failureHint
      || 'ElevenLabs unavailable or no audio returned. Audio is silent-only; subtitles use synthetic char-level timing.';
    items.push({
      stage: 'voice',
      kind: reason,
      severity: 'high',
      detail: hint,
    });
  }

  // Script — AI was attempted but fell back to deterministic.
  if (storyPackage.script?.ai_attempted && storyPackage.script?.ai_error) {
    items.push({
      stage: 'script',
      kind: 'ai_fallback_to_deterministic',
      severity: 'medium',
      detail: storyPackage.script.ai_error,
    });
  }

  // Assets — per-module fallback markers from resolve-assets.
  for (const m of storyPackage.modules || []) {
    const reason = m.asset?.fallbackReason;
    if (reason) {
      const item = {
        stage: 'assets',
        kind: reason,
        severity: 'medium',
        moduleId: m.moduleId,
        role: m.role,
        componentType: m.componentType,
      };
      if (m.asset?.fallbackHint) {
        item.detail = m.asset.fallbackHint;
      }
      items.push(item);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    has_fallbacks: items.length > 0,
    count: items.length,
    items,
  };
}

function writeFallbackReport(storyPackage, outputDir) {
  const report = buildFallbackReport(storyPackage);
  fs.writeFileSync(
    path.join(outputDir, 'fallback-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  return report;
}

function summarize(report) {
  if (!report.has_fallbacks) return 'no fallbacks';
  const counts = {};
  for (const item of report.items) {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  return `${report.count} fallback${report.count === 1 ? '' : 's'}: ` +
    Object.entries(counts).map(([k, v]) => v > 1 ? `${k}×${v}` : k).join(', ');
}

module.exports = {
  buildFallbackReport,
  writeFallbackReport,
  summarize,
};
