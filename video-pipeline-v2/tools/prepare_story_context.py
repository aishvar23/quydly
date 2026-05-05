#!/usr/bin/env python3
"""Create a story workspace ready for Claude.

Steps:
    1. Fetch the story (via fetch_story).
    2. Create stories/<story_id>/ if it doesn't exist.
    3. Write story.json (full payload from fetch).
    4. Infer story_type and look up the matching template under
       video-learning/templates/<story_type>.json.
    5. Copy the template into the workspace as template.json (we copy
       rather than symlink so the snapshot is frozen — if the operator
       tightens the template later, this story still has the version
       it was built against).
    6. Write _meta.json with provenance: when fetched, which template
       version, where the prompts live.

Idempotent. Safe to re-run; existing artifacts are not overwritten unless
--force is passed.

Usage:
    python tools/prepare_story_context.py --story-id 215
    python tools/prepare_story_context.py --story-id 215 --force
    python tools/prepare_story_context.py --story-id 215 --story-type finance

Exit codes:
    0 — ok
    1 — Supabase config missing
    2 — story id not found
    3 — unexpected error
    4 — could not infer a story_type and --story-type was not provided
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_story import fetch_story  # noqa: E402
from lib.paths import (  # noqa: E402
    repo_root,
    story_dir,
    story_artifact_path,
    templates_dir,
    prompts_dir,
    playbook_dir,
)
from lib.story_type import infer_story_type  # noqa: E402
from lib.supabase_client import SupabaseConfigError  # noqa: E402


# Story types that have a template file in video-learning/templates/.
# Inference may return others (conflict, policy) — we accept those but
# warn loudly, since the operator likely needs to add the template.
TEMPLATE_TYPES = {"legal-scandal", "geopolitics", "finance", "tech"}


def _write_json(path: Path, payload: dict, force: bool) -> bool:
    """Write JSON only if missing or --force. Returns True if it wrote."""
    if path.exists() and not force:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, default=str, ensure_ascii=False),
        encoding="utf-8",
    )
    return True


def _resolve_template(story_type: str) -> tuple[Path | None, str]:
    """Resolve the template path for a story_type.

    Returns (path, note). `path` is None if no template file exists.
    `note` is a one-line message about what happened — used for stdout
    reporting and for _meta.json provenance.
    """
    template_path = templates_dir() / f"{story_type}.json"
    if template_path.exists():
        return template_path, f"template found: {template_path.name}"
    if story_type in {"conflict", "policy"}:
        return None, (
            f"no template for '{story_type}' yet — "
            f"add video-learning/templates/{story_type}.json"
        )
    if story_type == "unknown":
        return None, (
            "story_type='unknown' — inference rules did not match. "
            "Re-run with --story-type <type>, or extend lib/story_type.py."
        )
    return None, f"unexpected story_type '{story_type}'"


def prepare_context(
    story_id: int,
    *,
    explicit_type: str | None = None,
    force: bool = False,
) -> dict:
    """Create the workspace and return a summary dict for the caller."""
    # 1–3 — fetch + write story.json
    payload = fetch_story(story_id)
    row = payload["row"]

    workspace = story_dir(story_id)
    workspace.mkdir(parents=True, exist_ok=True)

    source_path = story_artifact_path(story_id, "source")
    wrote_source = _write_json(source_path, payload, force)

    # 4 — story_type
    if explicit_type:
        story_type = explicit_type
        type_provenance = "explicit (--story-type)"
    else:
        story_type = infer_story_type(row)
        type_provenance = "inferred (lib/story_type.py)"

    # 5 — template copy
    template_src, template_note = _resolve_template(story_type)
    template_dst = story_artifact_path(story_id, "template")
    template_version = None
    template_copied = False
    if template_src is not None and (force or not template_dst.exists()):
        try:
            shutil.copyfile(template_src, template_dst)
            template_copied = True
            try:
                template_version = json.loads(
                    template_dst.read_text(encoding="utf-8")
                ).get("version")
            except json.JSONDecodeError:
                template_version = None
        except OSError as err:
            template_note = f"copy failed: {err}"

    # 6 — _meta.json
    meta_path = story_artifact_path(story_id, "meta")
    now = datetime.now(timezone.utc).isoformat()
    if meta_path.exists() and not force:
        existing = json.loads(meta_path.read_text(encoding="utf-8"))
        existing["last_prepared_at"] = now
        # Reflect any shifts (story_type override, new template version).
        existing["story_type"] = story_type
        existing["story_type_provenance"] = type_provenance
        existing["template_version"] = template_version
        existing["template_note"] = template_note
        meta = existing
    else:
        meta = {
            "story_id": story_id,
            "created_at": now,
            "last_prepared_at": now,
            "story_type": story_type,
            "story_type_provenance": type_provenance,
            "template_version": template_version,
            "template_note": template_note,
            "paths": {
                "workspace": str(workspace.relative_to(repo_root())),
                "prompts":   str(prompts_dir().relative_to(repo_root())),
                "playbook":  str(playbook_dir().relative_to(repo_root())),
                "templates": str(templates_dir().relative_to(repo_root())),
            },
            "schema_version": "1.0.0",
        }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return {
        "workspace":       str(workspace.relative_to(repo_root())),
        "story_type":      story_type,
        "story_type_note": type_provenance,
        "template_note":   template_note,
        "template_copied": template_copied,
        "wrote_source":    wrote_source,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Prepare a story workspace at stories/<story_id>/.",
        epilog="See tools/README.md for usage examples.",
    )
    ap.add_argument("--story-id", type=int, required=True)
    ap.add_argument("--story-type", default=None,
                    help="Override the inferred story_type. Use when "
                         "inference returns 'unknown' or when you know "
                         "better than the rules.")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite existing story.json / template.json. "
                         "Use with care — may discard manual edits.")
    args = ap.parse_args()

    try:
        summary = prepare_context(
            args.story_id,
            explicit_type=args.story_type,
            force=args.force,
        )
    except SupabaseConfigError as err:
        print(f"[prepare] {err}", file=sys.stderr)
        return 1
    except LookupError as err:
        print(f"[prepare] {err}", file=sys.stderr)
        return 2
    except Exception as err:  # noqa: BLE001
        print(f"[prepare] unexpected error: {err}", file=sys.stderr)
        return 3

    if summary["story_type"] == "unknown" and not args.story_type:
        print(f"[prepare] story_type could not be inferred. Re-run with "
              f"--story-type <type>. {summary['template_note']}",
              file=sys.stderr)
        return 4

    print(f"[prepare] workspace: {summary['workspace']}")
    print(f"[prepare] story_type: {summary['story_type']} ({summary['story_type_note']})")
    print(f"[prepare] {summary['template_note']}")
    if summary["template_copied"]:
        print(f"[prepare] template snapshot copied into workspace.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
