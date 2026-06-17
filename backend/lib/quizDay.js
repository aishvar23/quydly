// The current "quiz day".
//
// The daily quiz resets at 07:00 UTC, matching the Vercel cron ("0 7 * * *")
// that generates it. Before that reset the current quiz day is still the
// PREVIOUS calendar date — so the row the cron wrote at the last 07:00 boundary
// is the one in play. Keying questions, completions, and progress to this
// (instead of the midnight-UTC calendar date) keeps reads, writes, and the cron
// aligned, and removes the 00:00–07:00 window where "today's" row doesn't exist
// yet and the read path would otherwise serve a stale fallback.
//
// Matches the product spec / CLAUDE.md: "5 questions, ~3 min, resets 7AM."
export const RESET_HOUR_UTC = 7;

export function quizDay(now = new Date()) {
  return new Date(now.getTime() - RESET_HOUR_UTC * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
