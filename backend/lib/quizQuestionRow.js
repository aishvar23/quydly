// Canonical quiz_questions row shape. Both the generator (generateDaily) and
// the backfill build rows through here so the column mapping can't drift —
// previously each duplicated the snake_case mapping and had already diverged
// on missing-field handling.
export function toQuizQuestionRow({
  id, date, audience, categoryId, question, options, correctIndex, tldr, storyId = null,
}) {
  return {
    id,
    date,
    audience,
    category_id:   categoryId,
    question,
    options,
    correct_index: correctIndex,
    tldr,
    story_id:      storyId,
  };
}
