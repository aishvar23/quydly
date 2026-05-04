'use strict';

// Enforces scene asset diversity rules:
// - No repeated assets across scenes
// - Max 2 consecutive clips of the same asset type
// - At least 1 map and 1 motion graphic across the full video

class SceneDiversityTracker {
  constructor() {
    this.usedUrls       = new Set();
    this.typeSequence   = [];
    this.consecutiveRun = 0;
    this.lastType       = null;
  }

  canUse(url, assetType) {
    if (url && this.usedUrls.has(url)) return false;
    if (assetType === this.lastType && this.consecutiveRun >= 2) return false;
    return true;
  }

  record(url, assetType) {
    if (url) this.usedUrls.add(url);
    if (assetType === this.lastType) {
      this.consecutiveRun++;
    } else {
      this.consecutiveRun = 1;
      this.lastType       = assetType;
    }
    this.typeSequence.push(assetType);
  }

  // Suggests a forced type for remaining scenes to ensure mix requirements.
  // Returns null if the current selection is fine.
  getMixSuggestion(scenesRemaining) {
    const hasMap    = this.typeSequence.includes('map');
    const hasMotion = this.typeSequence.includes('motion_graphic');

    if (!hasMap && scenesRemaining <= 2 && scenesRemaining > 0) return 'map';
    if (!hasMotion && scenesRemaining <= 1)                       return 'motion_graphic';
    return null;
  }
}

module.exports = { SceneDiversityTracker };
