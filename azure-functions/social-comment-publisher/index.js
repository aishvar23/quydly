// Azure Timer Function: social-comment-publisher
// Trigger: every 15 minutes — "0 */15 * * * *"
//
// Posts the IG engagement "answer" comment ~12h after a carousel post goes live.
// Claims due social_post_engagement rows (comment_status='SCHEDULED' AND
// comment_due_at <= now), posts the answer comment on the IG media, and flips the
// row to POSTED (or FAILED after bounded retries). Idempotent: never comments
// twice on a post. Gated on SOCIAL_IG_ENGAGEMENT_ENABLED; no-ops cleanly if the
// Meta creds are unset. See lib/social/social-comment-publisher.js.

import { getSupabase } from "../lib/clients.js";
import { publishDueComments } from "../lib/social/social-comment-publisher.js";

export default async function socialCommentPublisher(context, timer) {
  if (timer.isPastDue) {
    context.log("Timer is past due — running now.");
  }

  const supabase = getSupabase();
  const { posted, failed, skipped } = await publishDueComments({
    supabase,
    logger: context.log,
  });

  context.log(JSON.stringify({
    event: "social_comment_publisher_run",
    posted,
    failed,
    skipped,
  }));
}
