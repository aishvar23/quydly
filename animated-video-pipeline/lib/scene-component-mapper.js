'use strict';

// Maps each script scene to the Remotion component type that should render it.
// Rules:
//   - Scene 1 is always HookScene (hero treatment)
//   - brand_outro concept → OutroScene
//   - geo_map concept or map asset → MapScene
//   - list_charges purpose → ChargeScene (legal_scandal detail)
//   - Everything else → ContextScene

function assignComponentTypes(scenes) {
  for (const scene of scenes) {
    if (scene.scene_id === 1) {
      scene.component_type = 'HookScene';
    } else if (scene.safe_visual_concept === 'brand_outro') {
      scene.component_type = 'OutroScene';
    } else if (scene.safe_visual_concept === 'geo_map' || scene.asset_type === 'map') {
      scene.component_type = 'MapScene';
    } else if (scene.scene_purpose === 'list_charges') {
      scene.component_type = 'ChargeScene';
    } else {
      scene.component_type = 'ContextScene';
    }
  }
}

module.exports = { assignComponentTypes };
