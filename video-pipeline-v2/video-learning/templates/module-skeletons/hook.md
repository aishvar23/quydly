# Module: hook

The first 3 seconds. The viewer decides whether to keep watching here.

## Renderer contract
- `kind: "hook"`
- `duration_sec`: ≤ 4.0
- `text`: one sentence, ≤ 22 words, ≤ 110 characters
- `asset_hint`: `map` | `data` | `mute`. Avoid `photo` — too many failure
  modes (wrong photo, generic stock, mistimed).
- `evidence_ref`: at least one source_id

## Beat structure
1. **Concrete subject** in the first 4 words — a proper noun or a number.
2. **Verb + object** — what happened, not what might happen.
3. **Optional time/place tag** — "on Tuesday", "in Brussels".

## Examples (shape, not copy)
- "Tokyo grounded all flights to Sapporo on Tuesday after the earthquake."
- "The Fed held rates at 4.50% for a fifth straight meeting."
- "At least 47 people were killed in Khan Younis on Sunday."

## Banned constructions
- Questions ("What if...", "Why did...")
- Hedges ("could", "may", "appears to")
- Moralising adjectives ("brutal", "shocking", "tragic")
- Generic openers ("In a major development...", "Breaking:")

## When to fail open
If you cannot write a hook that satisfies these constraints from the
evidence package, that is a stage 2 problem (insufficient evidence), not a
stage 3 problem. Surface it; do not weaken the hook.
