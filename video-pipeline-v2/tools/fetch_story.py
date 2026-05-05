#!/usr/bin/env python3
"""Fetch a story by id from Supabase and emit a single JSON document.

Output shape:
    {
      "row":           { ... full stories row ... },
      "cluster":       { ... or null },
      "raw_articles":  [ ... rows ordered by authority_score desc ... ],
      "fetched_at":    "<UTC ISO timestamp>"
    }

Usage:
    # Print to stdout (handy for piping or `jq`).
    python tools/fetch_story.py --story-id 215

    # Write to a file.
    python tools/fetch_story.py --story-id 215 --out story-215.json

Requires:
    SUPABASE_URL          set in .env or env
    SUPABASE_SERVICE_KEY  set in .env or env

Exit codes:
    0 — ok
    1 — Supabase config missing (check .env / .env.example)
    2 — story id not found
    3 — unexpected error from Supabase or filesystem
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make `lib.*` importable when invoked as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.supabase_client import (  # noqa: E402
    SupabaseConfigError,
    fetch_cluster,
    fetch_raw_articles,
    fetch_story_row,
)


def fetch_story(story_id: int) -> dict:
    """Fetch the row + cluster + raw_articles for a story.

    The cluster is optional; if the story has no cluster_id (rare on
    legacy rows), `cluster` is null and `raw_articles` is empty. The
    caller decides whether that's recoverable or a hard fail.
    """
    row = fetch_story_row(story_id)

    cluster = fetch_cluster(row.get("cluster_id"))
    article_ids = (cluster or {}).get("article_ids") or []
    # The schema stores article_ids as int[]; coerce just in case the
    # client returned strings.
    article_ids = [int(x) for x in article_ids if x is not None]

    raw_articles = fetch_raw_articles(article_ids)

    return {
        "row": row,
        "cluster": cluster,
        "raw_articles": raw_articles,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Fetch a Supabase story to JSON.",
        epilog="See tools/README.md for usage examples.",
    )
    ap.add_argument("--story-id", type=int, required=True,
                    help="Numeric id from the `stories` table.")
    ap.add_argument("--out", type=Path, default=None,
                    help="Path to write JSON to (default: stdout).")
    args = ap.parse_args()

    try:
        payload = fetch_story(args.story_id)
    except SupabaseConfigError as err:
        print(f"[fetch_story] supabase config: {err}", file=sys.stderr)
        return 1
    except LookupError as err:
        print(f"[fetch_story] {err}", file=sys.stderr)
        return 2
    except Exception as err:  # noqa: BLE001 — surface any other failure
        print(f"[fetch_story] unexpected error: {err}", file=sys.stderr)
        return 3

    text = json.dumps(payload, indent=2, default=str, ensure_ascii=False)

    if args.out:
        try:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text, encoding="utf-8")
            print(f"[fetch_story] wrote {args.out}", file=sys.stderr)
        except OSError as err:
            print(f"[fetch_story] write failed: {err}", file=sys.stderr)
            return 3
    else:
        # stdout — use sys.stdout.write to avoid Windows print's CRLF on
        # JSON pipes.
        sys.stdout.write(text + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
