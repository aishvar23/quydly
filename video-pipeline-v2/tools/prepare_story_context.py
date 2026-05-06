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
    5 — service-journalism rejection (retail-deals / affiliate-aggregation
        pattern detected by lib.story_type; no workspace was created)
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


def _seed_service_journalism_rejection(
    story_id: int,
    payload: dict,
    type_provenance: str,
) -> str:
    """Seed a minimal rejection workspace for service-journalism rows.

    Writes story.json, _meta.json, _blockers.md, and a synthesized
    08_learning.json with one `failure` entry. Skips template.json and
    stages 1–7 because there is no story_type / template that fits.
    The artifacts satisfy update_learning.py's relaxed required set for
    `_meta.json.story_type == 'service-journalism'`, so the rejection
    is captured in the learning index even though the pipeline never
    ran stages 1–7.

    Returns a one-line note describing the rejection (used by the
    caller for stdout reporting and for the `template_note` field of
    the returned summary dict).
    """
    row = payload["row"]
    workspace = story_dir(story_id)
    workspace.mkdir(parents=True, exist_ok=True)

    rejection_note = (
        "rejected: service-journalism "
        "(editorial_posture=disclosure_official + "
        "NUMERIC_TRIVIA_RISK + quiz_candidate=false). "
        "See video-learning/prompts/01-story-understanding.md step 0."
    )

    # 1 — story.json (always, full payload — entries reference its fields).
    _write_json(story_artifact_path(story_id, "source"), payload, force=True)

    # 2 — _meta.json with rejection metadata. update_learning.py reads
    #     story_type from here to pick the relaxed artifact set.
    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "story_id": story_id,
        "created_at": now,
        "last_prepared_at": now,
        "story_type": "service-journalism",
        "story_type_provenance": type_provenance,
        "template_version": None,
        "template_note": rejection_note,
        "paths": {
            "workspace": str(workspace.relative_to(repo_root())),
            "prompts":   str(prompts_dir().relative_to(repo_root())),
            "playbook":  str(playbook_dir().relative_to(repo_root())),
            "templates": str(templates_dir().relative_to(repo_root())),
        },
        "schema_version": "1.0.0",
        "outcome": "rejected",
        "rejection_class": "service-journalism",
        "rejection_reason": rejection_note,
        "rejected_at": now,
    }
    story_artifact_path(story_id, "meta").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )

    # 3 — _blockers.md narrative.
    quality_flags = row.get("quality_flags") or []
    quiz_candidate = row.get("quiz_candidate")
    consistency_score = row.get("consistency_score")
    posture = row.get("editorial_posture")
    blockers_md = (
        f"# Story {story_id} — service-journalism rejection\n\n"
        f"**Outcome:** `rejected` (auto-seeded by `tools/prepare_story_context.py`)\n"
        f"**Class:** `service-journalism`\n"
        f"**Date:** {now[:10]}\n\n"
        f"## Why\n\n"
        f"`tools/lib/story_type.py` step 0 matched the retail-deals / "
        f"affiliate-aggregation pattern. The synth's own signals on this row:\n\n"
        f"- `editorial_posture`: `{posture!r}`\n"
        f"- `quality_flags`: `{quality_flags!r}`\n"
        f"- `quiz_candidate`: `{quiz_candidate!r}`\n"
        f"- `consistency_score`: `{consistency_score!r}`\n\n"
        f"All three step-0 conditions held: `editorial_posture == "
        f"'disclosure_official'` AND `quality_flags` contains "
        f"`NUMERIC_TRIVIA_RISK` AND `quiz_candidate is False`.\n\n"
        f"## What ran\n\n"
        f"- `tools/prepare_story_context.py` wrote `story.json`, "
        f"`_meta.json`, `_blockers.md`, and `08_learning.json`.\n"
        f"- `tools/process_story.py` exited with code 5 — no Claude session.\n\n"
        f"## What runs next\n\n"
        f"```\n"
        f"python tools/update_learning.py --story-id {story_id}\n"
        f"```\n\n"
        f"The rollup uses the relaxed artifact set "
        f"`[source, meta, learning]` for `story_type=='service-journalism'`.\n"
    )
    (workspace / "_blockers.md").write_text(blockers_md, encoding="utf-8")

    # 4 — 08_learning.json synthesized with one failure entry. Schema-
    #     validated by `validate_artifact.py --stage learning` if the
    #     operator wants to confirm.
    learning = {
        "story_id": story_id,
        "story_type": "service-journalism",
        "outcome": "rejected",
        "subjective_quality": None,
        "entries": [
            {
                "category": "failure",
                "summary": (
                    "Service-journalism / retail-deals row rejected at "
                    "stage 1 step 0. The synth had already flagged it "
                    "(disclosure_official posture + NUMERIC_TRIVIA_RISK "
                    "+ quiz_candidate=false); the pipeline now refuses "
                    "to render rather than producing a video the synth "
                    "itself declined."
                ),
                "evidence": (
                    "stories/{sid}/story.json:row.editorial_posture, "
                    "row.quality_flags, row.quiz_candidate; "
                    "tools/lib/story_type.py:infer_story_type step 0; "
                    "video-learning/prompts/01-story-understanding.md "
                    "step 0; video-learning/prompts/02-evidence-package.md "
                    "gate-5"
                ).format(sid=story_id),
                "future_check": (
                    "Already enforced. tools/lib/story_type.py step 0 "
                    "returns the 'service-journalism' sentinel when "
                    "all three synth conditions hold; "
                    "prepare_story_context.py auto-seeds the rejection "
                    "workspace; update_learning.py rolls the failure "
                    "entry into known-failure-modes.md. If a future "
                    "row of this shape slips through, the gap is in "
                    "the seed conditions — file a prompt_proposal "
                    "naming the missing condition."
                ),
                "links": [
                    "[2026-05-06 story 215] Stage 2 cleared a story "
                    "that the synthesizer itself had already flagged "
                    "as weak"
                ],
            }
        ],
    }
    _write_json(story_artifact_path(story_id, "learning"), learning, force=True)

    return rejection_note


def prepare_context(
    story_id: int,
    *,
    explicit_type: str | None = None,
    force: bool = False,
) -> dict:
    """Create the workspace and return a summary dict for the caller.

    For service-journalism rows (lib.story_type returns the sentinel),
    seeds a minimal rejection workspace via
    `_seed_service_journalism_rejection` so the rollup can capture the
    rejection. Caller should still treat this as a rejection;
    tools/process_story.py exits with code 5.
    """
    # 1 — fetch
    payload = fetch_story(story_id)
    row = payload["row"]

    # 2 — story_type (decide first; service-journalism takes the
    #     rejection path before any normal-flow workspace setup).
    if explicit_type:
        story_type = explicit_type
        type_provenance = "explicit (--story-type)"
    else:
        story_type = infer_story_type(row)
        type_provenance = "inferred (lib/story_type.py)"

    if story_type == "service-journalism" and not explicit_type:
        rejection_note = _seed_service_journalism_rejection(
            story_id, payload, type_provenance
        )
        return {
            "workspace":       str(story_dir(story_id).relative_to(repo_root())),
            "story_type":      "service-journalism",
            "story_type_note": type_provenance,
            "template_note":   rejection_note,
            "template_copied": False,
            "wrote_source":    True,
        }

    # 3 — workspace + write story.json (only if we did not reject above)
    workspace = story_dir(story_id)
    workspace.mkdir(parents=True, exist_ok=True)

    source_path = story_artifact_path(story_id, "source")
    wrote_source = _write_json(source_path, payload, force)

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

    if summary["story_type"] == "service-journalism":
        print(f"[prepare] {summary['template_note']}", file=sys.stderr)
        return 5

    print(f"[prepare] workspace: {summary['workspace']}")
    print(f"[prepare] story_type: {summary['story_type']} ({summary['story_type_note']})")
    print(f"[prepare] {summary['template_note']}")
    if summary["template_copied"]:
        print(f"[prepare] template snapshot copied into workspace.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
