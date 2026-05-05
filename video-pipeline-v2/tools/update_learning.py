#!/usr/bin/env python3
"""Roll a story's 08_learning.json into the system-wide learning index.

What it does:
    1. Validates that the story workspace has the artifacts it should
       have given its outcome (insufficient → only stages 1–2; otherwise
       all stages through 08_learning.json).
    2. Reads 08_learning.json.
    3. Appends a per-story section to LEARNING_RECORD.md.
    4. Routes `failure` entries into known-failure-modes.md.
    5. Routes `pattern` entries into known-good-patterns.md.
    6. Surfaces a "files to patch" report from `*_proposal` entries —
       these are NOT auto-applied; the operator promotes between stories.

Output learning files (lazy-created on first run):
    video-learning/learning/LEARNING_RECORD.md
    video-learning/learning/known-failure-modes.md
    video-learning/learning/known-good-patterns.md

Usage:
    python tools/update_learning.py --story-id 215
    python tools/update_learning.py --story-folder stories/215

Exit codes:
    0 — ok (entries rolled in)
    1 — workspace not found
    2 — required artifacts missing for the outcome the story claims
    3 — 08_learning.json malformed or missing
    4 — write failure on the learning files
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.paths import (  # noqa: E402
    STAGE_ARTIFACTS,
    learning_dir,
    repo_root,
    story_artifact_path,
    story_dir,
)


# Filenames at the learning index level. Lazy-created.
_FILES = {
    "record":   "LEARNING_RECORD.md",
    "failures": "known-failure-modes.md",
    "patterns": "known-good-patterns.md",
}

# Headers used when a learning file is created from scratch.
_FILE_HEADERS = {
    "record": (
        "# Learning record\n\n"
        "Append-only journal. One section per story, written by\n"
        "`tools/update_learning.py`. Newest at the bottom.\n\n"
        "A `PROPOSAL (...)` indented sub-bullet flags an entry that needs\n"
        "operator review at the next playbook revision — promotions are\n"
        "deliberate, never auto-applied.\n"
    ),
    "failures": (
        "# Known failure modes\n\n"
        "Append-only. Each line:\n"
        "`[<date> story <id>] <one-line failure> — check: <future test>`.\n"
        "Read by every fresh Claude before stage 1 and stage 5.\n"
    ),
    "patterns": (
        "# Known good patterns\n\n"
        "Append-only. Each line:\n"
        "`[<date> story <id>] <one-line pattern> — replicate: <how>`.\n"
        "Read by every fresh Claude before stages 3 and 4.\n"
    ),
}


# `category` → (target_file_key, line_template). The template is a
# format-string with named fields. An empty template means the entry is
# only written to the main record (proposals).
_ROUTING: dict[str, tuple[str | None, str]] = {
    "failure":            ("failures", "- [{date} story {sid}] {summary} — check: {check}"),
    "pattern":            ("patterns", "- [{date} story {sid}] {summary} — replicate: {check}"),
    "rule_proposal":      (None, ""),
    "template_proposal":  (None, ""),
    "prompt_proposal":    (None, ""),
    "example_promotion":  (None, ""),
}


def _resolve_workspace(args: argparse.Namespace) -> Path:
    """Pick a workspace from --story-id or --story-folder."""
    if args.story_folder:
        path = Path(args.story_folder).resolve()
        if not path.is_dir():
            raise FileNotFoundError(f"not a directory: {path}")
        return path
    if args.story_id is not None:
        return story_dir(args.story_id)
    raise SystemExit("provide --story-id or --story-folder")


def _validate_workspace(workspace: Path) -> tuple[str, list[str]]:
    """Return (outcome, missing_artifact_keys).

    Reads 08_learning.json.outcome to decide which artifacts are required.
    For 'rejected' (insufficient at stage 2) the post-stage-2 artifacts
    are not expected; for any other outcome the full set is required.
    """
    learning_path = workspace / STAGE_ARTIFACTS["learning"]
    if not learning_path.exists():
        return "missing", ["learning"]

    try:
        learning = json.loads(learning_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise ValueError(f"08_learning.json is malformed: {err}") from err

    outcome = learning.get("outcome", "?")
    if outcome == "rejected":
        # Stage-2 rejection: only seed + understanding + evidence + learning.
        required = ["source", "template", "meta", "understanding", "evidence", "learning"]
    else:
        required = [
            "source", "template", "meta",
            "understanding", "evidence", "script", "module_plan",
            "pre_render", "post_render", "learning",
        ]
    missing = [k for k in required if not (workspace / STAGE_ARTIFACTS[k]).exists()]
    return outcome, missing


def _ensure_learning_files() -> dict[str, Path]:
    """Lazy-create learning files on first run. Returns a dict of paths."""
    base = learning_dir()
    base.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for key, name in _FILES.items():
        p = base / name
        if not p.exists():
            p.write_text(_FILE_HEADERS[key], encoding="utf-8")
        paths[key] = p
    return paths


def _append(path: Path, text: str) -> None:
    """Append, ensuring a trailing newline. Creates the file if missing
    (defensive — _ensure_learning_files should have run first)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
    with path.open("a", encoding="utf-8") as fh:
        fh.write(text.rstrip() + "\n")


def _format_record_section(learning: dict, date: str) -> str:
    sid = learning.get("story_id", "?")
    stype = learning.get("story_type", "?")
    outcome = learning.get("outcome", "?")
    quality = learning.get("subjective_quality")
    qtag = f"q{quality}" if quality is not None else "q-"
    return f"\n## Story {sid} — {date} — {stype} — outcome: {outcome} — {qtag}\n"


def _format_record_entry(entry: dict) -> str:
    cat = entry.get("category", "?")
    summary = (entry.get("summary") or "").strip()
    evidence = (entry.get("evidence") or "").strip()
    future = (entry.get("future_check") or "").strip()
    return f"- **{cat}** — {summary} _(evidence: {evidence})_ → check: {future}"


def _suggest_patches(learning: dict) -> list[str]:
    """Build the human-readable 'files to patch' report from `*_proposal`
    entries. Order: rule, template, prompt, example."""
    proposals = {
        "rule_proposal": [],
        "template_proposal": [],
        "prompt_proposal": [],
        "example_promotion": [],
    }
    for entry in learning.get("entries") or []:
        cat = entry.get("category")
        if cat in proposals:
            proposals[cat].append(entry)

    if not any(proposals.values()):
        return []

    lines: list[str] = []
    lines.append("Files to patch (operator review, between stories):")
    if proposals["rule_proposal"]:
        lines.append("  PLAYBOOK — video-learning/playbook/video-pipeline-playbook.md")
        for e in proposals["rule_proposal"]:
            lines.append(f"    - {(e.get('summary') or '').strip()}")
    if proposals["template_proposal"]:
        lines.append("  TEMPLATES — video-learning/templates/<type>.json")
        for e in proposals["template_proposal"]:
            lines.append(f"    - {(e.get('summary') or '').strip()}")
    if proposals["prompt_proposal"]:
        lines.append("  PROMPTS — video-learning/prompts/0X-*.md")
        for e in proposals["prompt_proposal"]:
            lines.append(f"    - {(e.get('summary') or '').strip()}")
    if proposals["example_promotion"]:
        lines.append("  APPROVED EXAMPLES — promote this story's artifacts")
        for e in proposals["example_promotion"]:
            lines.append(f"    - {(e.get('summary') or '').strip()}")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Roll a story's learning entries into the index.",
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--story-id", type=int)
    src.add_argument("--story-folder", type=str,
                     help="Path to a story workspace; lets you operate "
                          "on workspaces outside stories/<id>/.")
    args = ap.parse_args()

    try:
        workspace = _resolve_workspace(args)
    except FileNotFoundError as err:
        print(f"[update_learning] {err}", file=sys.stderr)
        return 1

    if not workspace.exists():
        print(f"[update_learning] workspace not found: {workspace}", file=sys.stderr)
        return 1

    try:
        outcome, missing = _validate_workspace(workspace)
    except ValueError as err:
        print(f"[update_learning] {err}", file=sys.stderr)
        return 3

    if missing:
        print(f"[update_learning] required artifacts missing for outcome="
              f"'{outcome}':", file=sys.stderr)
        for k in missing:
            print(f"  - {STAGE_ARTIFACTS[k]}", file=sys.stderr)
        return 2

    # Read learning payload.
    learning_path = workspace / STAGE_ARTIFACTS["learning"]
    learning = json.loads(learning_path.read_text(encoding="utf-8"))
    sid = learning.get("story_id", workspace.name)
    date = datetime.now(timezone.utc).date().isoformat()

    # Lazy-create the learning files.
    try:
        paths = _ensure_learning_files()
    except OSError as err:
        print(f"[update_learning] could not create learning files: {err}",
              file=sys.stderr)
        return 4

    # Append the per-story section header.
    try:
        _append(paths["record"], _format_record_section(learning, date))

        entries = learning.get("entries") or []
        if not entries:
            _append(paths["record"], "_(no entries)_")

        for entry in entries:
            _append(paths["record"], _format_record_entry(entry))
            cat = entry.get("category", "?")
            target_key, template = _ROUTING.get(cat, (None, ""))
            if target_key and template:
                line = template.format(
                    date=date,
                    sid=sid,
                    summary=(entry.get("summary") or "").strip(),
                    check=(entry.get("future_check") or "").strip(),
                )
                _append(paths[target_key], line)
            elif cat in {"rule_proposal", "template_proposal",
                         "prompt_proposal", "example_promotion"}:
                _append(paths["record"],
                        f"  - PROPOSAL ({cat}): review at next revision.")
    except OSError as err:
        print(f"[update_learning] write failed: {err}", file=sys.stderr)
        return 4

    # Console report.
    print(f"[update_learning] rolled {len(entries)} entries from "
          f"{learning_path.relative_to(repo_root())}")
    print(f"[update_learning] record: "
          f"{paths['record'].relative_to(repo_root())}")

    patch_report = _suggest_patches(learning)
    if patch_report:
        print()
        for line in patch_report:
            print(line)
    else:
        print("[update_learning] no proposals — index updated only.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
