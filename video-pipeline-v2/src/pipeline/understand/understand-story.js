'use strict';

const { classify } = require('./story-types');

function understandStory(story, audit) {
  const type = classify(story);
  if (!type) {
    throw new Error(
      `No story type matched. Story id ${story.id}. ` +
      `Add a story type to src/pipeline/understand/story-types/.`,
    );
  }
  const understanding = type.understand(story, audit);
  return {
    ...understanding,
    story_type: type.id, // enforce
  };
}

module.exports = {
  understandStory,
};
