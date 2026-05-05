#!/usr/bin/env python3
"""High-level orchestrator. One command per story.

What it does:
    1. If the workspace doesn't exist, calls prepare_story_context.
    2. Verifies the required seed files are present (story.json,
       template.json, _meta.json).
    3. Prints the exact instruction block to paste into a fresh Claude
       session.

This script does NOT call the LLM and does NOT produce stage artifacts.
Stages 1–8 are executed by Claude reading the prompts under
video-learning/prompts/. The script just does the deterministic setup
and the final hand-off.

Usage:
    # First time for a story (fetches + sets up + prints runner block).
    python tools/process_story.py --story-id 215

    # Re-print the runner block for an existing workspace.
    python tools/process_story.py --story-id 215 --reuse

    # Verify only — exit non-zero if the workspace is incomplete.
    python tools/process_story.py --story-id 215 --check

Exit codes:
    0 — ok
    1 — Supabase or filesystem setup error
    2 — story not found in Supabase
    3 — required files missing in --check mode
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.paths import (  # noqa: E402
    repo_root,
    story_dir,
    story_artifact_path,
    playbook_dir,
    prompts_dir,
)
from prepare_story_context import prepare_context  # noqa: E402
from lib.supabase_client import SupabaseConfigError  # noqa: E402


# Seed files that must exist before Claude can start stage 1.
_SEED_KEYS = ["source", "template", "meta"]


def _seed_files_present(story_id: int) -> tuple[bool, list[str]]:
    """Return (all_present, missing_paths)."""
    missing: list[str] = []
    for key in _SEED_KEYS:
        path = story_artifact_path(story_id, key)
        if not path.exists():
            missing.append(str(path.relative_to(repo_root())))
    return len(missing) == 0, missing


def _runner_block(story_id: int) -> str:
    """The text Claude needs in a fresh session. Stable wording so the
    operator knows what to expect every time."""
    workspace = story_dir(story_id).relative_to(repo_root())
    runner = (playbook_dir() / "claude-runner.md").relative_to(repo_root())
    prompts = prompts_dir().relative_to(repo_root())

    # _meta.json carries the resolved story_type, so we surface it for
    # the operator's quick read.
    meta_path = story_artifact_path(story_id, "meta")
    story_type = "?"
    template_note = ""
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            story_type = meta.get("story_type", "?")
            template_note = meta.get("template_note", "")
        except json.JSONDecodeError:
            pass

    return (
        f"You are processing story {story_id} through the video pipeline.\n"
        f"\n"
        f"Read the runner instructions and follow them in order:\n"
        f"  {runner}\n"
        f"\n"
        f"Workspace: {workspace}\n"
        f"  - story.json   — full Supabase row + cluster + raw_articles\n"
        f"  - template.json — frozen story-type template\n"
        f"  - _meta.json    — provenance and paths\n"
        f"\n"
        f"Inferred story_type: {story_type}\n"
        f"{('Template: ' + template_note) if template_note else ''}\n"
        f"\n"
        f"Prompts (one per stage): {prompts}\n"
        f"\n"
        f"Start at stage 1 (01-story-understanding.md). Stop after stage 5\n"
        f"and report the pre-render critique to the operator.\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Set up a story workspace and print the Claude runner block.",
    )
    ap.add_argument("--story-id", type=int, required=True)
    ap.add_argument("--reuse", action="store_true",
                    help="Skip fetch / setup if the workspace already "
                         "exists; just re-print the runner block.")
    ap.add_argument("--check", action="store_true",
                    help="Verify the workspace is complete without "
                         "fetching or printing the runner. Exits non-zero "
                         "if seed files are missing.")
    ap.add_argument("--story-type", default=None,
                    help="Pass through to prepare_story_context.")
    args = ap.parse_args()

    workspace = story_dir(args.story_id)

    # --check mode: pure verification, no setup work.
    if args.check:
        ok, missing = _seed_files_present(args.story_id)
        if ok:
            print(f"[process] OK: workspace at {workspace.relative_to(repo_root())}")
            return 0
        print(f"[process] FAIL: missing seed files in {workspace}:",
              file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        return 3

    # --reuse: if seeds present, skip the fetch.
    if args.reuse:
        ok, missing = _seed_files_present(args.story_id)
        if not ok:
            print(f"[process] --reuse asked but seeds missing: {missing}\n"
                  f"          dropping --reuse and running setup.",
                  file=sys.stderr)
            args.reuse = False  # fall through to setup

    if not args.reuse:
        try:
            summary = prepare_context(
                args.story_id,
                explicit_type=args.story_type,
                force=False,
            )
        except SupabaseConfigError as err:
            print(f"[process] supabase config: {err}", file=sys.stderr)
            return 1
        except LookupError as err:
            print(f"[process] {err}", file=sys.stderr)
            return 2
        except Exception as err:  # noqa: BLE001
            print(f"[process] setup failed: {err}", file=sys.stderr)
            return 1

        if summary["story_type"] == "unknown":
            print(f"[process] story_type could not be inferred. Re-run "
                  f"with --story-type <type>.", file=sys.stderr)
            return 1

        print(f"[process] setup ok — story_type={summary['story_type']}")

    # Final verification before printing the runner block.
    ok, missing = _seed_files_present(args.story_id)
    if not ok:
        print(f"[process] seeds still missing after setup: {missing}",
              file=sys.stderr)
        return 1

    print()
    print("=" * 72)
    print(" Workspace is ready. Open a fresh Claude session and paste:")
    print("=" * 72)
    print()
    print(_runner_block(args.story_id))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
