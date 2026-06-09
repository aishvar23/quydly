# Bug: `stories.timeline_events` are stamped with the wrong year

**Status:** Open — diagnosed, not yet fixed
**Area:** News pipeline → story enrichment (`azure-functions/lib/enrichment.js`)
**Severity:** Data quality. User-facing risk: wrong dates can surface anywhere `timeline_events` is consumed (e.g. the IG carousel "Why it matters" grounding).
**Found:** 2026-06-08, while reviewing live output of the IG carousel "Why it matters" feature.

## Symptom

Stories published in 2026 carry `timeline_events` entries dated **2024** (and sometimes with month/day drift too), even though the events actually happened in 2026. The sibling field `related_stories` on the same rows is correctly dated 2026.

### Evidence (pulled live from Supabase)

| Story | `published_at` | Bad `timeline_events` |
|---|---|---|
| 779 — "Former BJP TN Chief K Annamalai Launches New Political Movement" | 2026-06-05 | `2024-06-05: Annamalai resigns from BJP, launches movement` · `2024-06-06: BJP leadership refuses support for new movement` |
| 787 — "FCC Chair Brendan Carr Slams Fired 60 Minutes Host Scott Pelley" | 2026-06-05 | `2024-12-15: Pelley fired…` · `2024-12-22: Pelley tells NYT…` · `2024-12-22: Carr slams Pelley on X` |
| 784 — "Rahul Gandhi meets student whistleblowers…" | 2026-06-04 | `2024-12-22: Rahul Gandhi meets whistleblower students` |

Note the month/day on 779 match the real publish date — only the **year** is wrong (2024 vs 2026).

## Root cause

The enrichment LLM that generates `timeline_events` is **given no date context** — not the source articles' `published_at`, not the story's `published_at`, and no "current date / current year" anchor. With no temporal grounding, the model (`claude-sonnet-4-20250514`, training-era 2024) defaults event years to **2024**.

- Prompt + article-block builder: `azure-functions/lib/enrichment.js` → `callEnrichmentLLM` (~lines 170–259). The article block (lines ~171–180) includes title/description/content only; each article's `published_at` is available upstream but dropped here. The prompt nowhere states the current date or the story date.
- Validator does not catch it: `sanitiseTimelineEvents` (`enrichment.js` ~lines 471–484) checks the `YYYY-MM-DD` **format** only — no year/recency sanity check — so `2024-06-05` passes straight through.
- Why `related_stories` is correct by contrast: `pickRelatedStories` (`story-synthesizer/index.js` ~lines 695–720) reads `published_at` directly from DB rows (`date: c.published_at ?? null`), with no LLM involved. Different code path → no drift.
- The existing article-date fallback `deriveTimelineFromArticles` (`enrichment.js` ~lines 433–469) only fires when the LLM produced ≤1 distinct date; in the bug cases the LLM emitted ≥2 distinct (wrong-year) dates, so the timeline is classified `multi_day` and the bad dates are kept verbatim.

## Recommended fix (two parts)

**Part A — anchor the prompt (primary).** In `callEnrichmentLLM`:
1. Include each article's `published_at` (date portion) in its `[Article N …]` header line.
2. Add an explicit anchor near the timeline rule, e.g. *"These articles were published around `<story published_at>`. Timeline event years MUST match the article publication dates above — do not use any other year."* Thread the story's `published_at` (or the articles' dates, already in the `articles` array) from the synthesizer into `enrichNarrative`.

**Part B — defensive clamp (belt-and-suspenders).** In `sanitiseTimelineEvents`, compute the min/max `published_at` year across `articles` and drop (or null out, letting the fallback fire) any event whose year falls outside `[minYear-1, maxYear]`. Catches future drift even if the prompt is later edited.

Ship both: A fixes the cause, B guarantees no wrong-year date reaches the column again.

## Caveats / fallout

- **Existing rows are not retroactively fixed.** Stories 779/787/784 and any others synthesized before the fix keep their bad dates unless re-synthesized or backfilled (a separate cleanup step).
- **Test fallout:** `azure-functions/test/enrichment.test.js` (lines ~67–68 and ~189–209) asserts `2024-03-28` / `2023-11-02` dates pass through. If Part B clamps against article `published_at` years, those fixtures need updating. The P3-4 disposition tests (~line 464+) already use 2026 dates and are unaffected.
- **Deploy:** changes live in `lib/enrichment.js` (plus a one-line arg thread in `story-synthesizer/index.js`). Azure Functions deploy; no env/threshold changes. Run `node --test test/enrichment.test.js` and `npm run lint` before done.

## Mitigation already in place

The IG carousel "Why it matters" prompt is grounded-first on `related_stories` (correctly dated) and instructs the model to omit any date it isn't confident about, so observed output mostly dodged the wrong years. This is mitigation, not a fix — the underlying `timeline_events` data is still wrong.
