'use strict';

const JOB_STATES = {
  QUEUED:                   'QUEUED',
  STORY_VALIDATED:          'STORY_VALIDATED',
  VIDEO_CANDIDATE_REJECTED: 'VIDEO_CANDIDATE_REJECTED',
  SCRIPT_READY:             'SCRIPT_READY',
  VOICE_READY:              'VOICE_READY',
  BEATS_ALIGNED:            'BEATS_ALIGNED',
  ASSETS_READY:             'ASSETS_READY',
  SUBTITLES_READY:          'SUBTITLES_READY',
  RENDER_READY:             'RENDER_READY',
  EXPORTED:                 'EXPORTED',
  METADATA_READY:           'METADATA_READY',
  COMPLETE:                 'COMPLETE',
  FAILED:                   'FAILED',
};

module.exports = { JOB_STATES };
