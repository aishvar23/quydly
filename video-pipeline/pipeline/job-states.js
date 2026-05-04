'use strict';

const JOB_STATES = {
  QUEUED:                    'QUEUED',
  STORY_VALIDATED:           'STORY_VALIDATED',
  VIDEO_CANDIDATE_REJECTED:  'VIDEO_CANDIDATE_REJECTED',
  STORY_UNDERSTOOD:          'STORY_UNDERSTOOD',
  EVIDENCE_PACKAGED:         'EVIDENCE_PACKAGED',
  SCRIPT_READY:              'SCRIPT_READY',
  VOICE_READY:               'VOICE_READY',
  MODULE_PLAN_READY:         'MODULE_PLAN_READY',
  BEATS_ALIGNED:             'BEATS_ALIGNED',
  ASSETS_READY:              'ASSETS_READY',
  SUBTITLES_READY:           'SUBTITLES_READY',
  RENDER_READY:              'RENDER_READY',
  EXPORTED:                  'EXPORTED',
  METADATA_READY:            'METADATA_READY',
  COMPLETE:                  'COMPLETE',
  FAILED:                    'FAILED',
};

module.exports = { JOB_STATES };
