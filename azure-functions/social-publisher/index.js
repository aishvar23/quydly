// Azure Timer Function: social-publisher
// Trigger: every 15 minutes — "0 */15 * * * *"
//
// Publishes admin-APPROVED (or SCHEDULED + due) posts to their platform.
// MVP = X only. Idempotent and capped per platform per day. See §9.3 / §12.3.

import { getSupabase } from "../lib/clients.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";

export default async function socialPublisher(context, timer) {
  if (timer.isPastDue) {
    context.log("Timer is past due — running now.");
  }

  const supabase = getSupabase();
  const { published, failed, skipped } = await publishApprovedPosts({
    supabase,
    logger: context.log,
  });

  context.log(JSON.stringify({
    event: "social_publisher_run",
    published,
    failed,
    skipped,
  }));
}
