# Module: close

The last 5–10 seconds. What to watch next, not a summary.

## Renderer contract
- `kind: "close"`
- `duration_sec`: 5.0–10.0
- `text`: 1–2 sentences, ≤ 40 words
- `asset_hint`: `data` | `mute` (no map for the close beat)
- `evidence_ref`: optional; usually a date or scheduled event

## Beat structure
1. **Forward-looking anchor** — a date, a scheduled meeting, an upcoming
   release. Never restate the hook.
2. **Optional concrete trigger** — "if <X> by <date>, then <consequence>".

## Examples (shape, not copy)
- "The Fed's next decision drops on June 12; futures price a 60bp cut by
  year end."
- "Talks resume Monday in Doha; both sides have until the end of the
  week to agree on prisoner exchange terms."
- "Earnings land November 7; analyst consensus is $2.10 a share."

## Banned constructions
- "Time will tell", "we'll see"
- A summary of the previous modules
- "Stay tuned"

## Common pitfalls
- Close that re-states the stakes with weaker words.
- Close that hedges harder than the rest of the script.
- Close anchored to a vague window ("soon", "in the coming weeks") instead
  of a date.
