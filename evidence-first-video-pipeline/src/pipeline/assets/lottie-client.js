'use strict';

function resolveLottieAccent(scene) {
  return {
    kind: 'lottie',
    path: null,
    sourceUrl: null,
    motionName: scene.sceneType,
  };
}

module.exports = {
  resolveLottieAccent,
};
