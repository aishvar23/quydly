'use strict';

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

  // Suggest a forced asset type to maintain mix requirements.
  getMixSuggestion(scenesRemaining) {
    const hasMap    = this.typeSequence.includes('map');
    const hasMotion = this.typeSequence.includes('motion_graphic');
    if (!hasMap    && scenesRemaining <= 2 && scenesRemaining > 0) return 'map';
    if (!hasMotion && scenesRemaining <= 1)                        return 'motion_graphic';
    return null;
  }
}

module.exports = { SceneDiversityTracker };
