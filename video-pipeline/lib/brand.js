'use strict';

const os = require('os');
const path = require('path');

const BRAND = {
  NAME:        'QUYDLY',
  BG_COLOR:    '0x0a0e1a',
  ACCENT:      '0x3b82f6',
  TEXT_WHITE:  'white',
  // Hook overlay (scene 1 — most prominent)
  HOOK_FONT_SIZE:  70,
  HOOK_OVERLAY_Y:  '0.60',
  HOOK_BOX_BG:     'black@0.72',
  HOOK_BOX_PAD:    32,
  // Standard editorial strap (selective, short scenes only)
  STRAP_FONT_SIZE: 46,
  STRAP_OVERLAY_Y: '0.72',
  STRAP_BOX_BG:    'black@0.55',
  STRAP_BOX_PAD:   20,
  // Watermark — V3: subtle
  WATERMARK_ALPHA: '0.55',
  WATERMARK_SIZE:  22,
  // Ken Burns
  KB_SCENE1_ZOOM:  1.12,   // strongest push-in for hook
  KB_DEFAULT_ZOOM: 1.08,   // moderate for other stills
  // Composition
  TRANSITION_DUR:  0.3,
  FPS:             30,
  WIDTH:           1080,
  HEIGHT:          1920,
};

function getFontPath() {
  if (process.env.FONT_PATH) return process.env.FONT_PATH;
  if (process.platform === 'win32') return 'C:/Windows/Fonts/arialbd.ttf';
  return '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
}

module.exports = { BRAND, getFontPath };
