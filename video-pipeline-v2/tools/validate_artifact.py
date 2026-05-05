#!/usr/bin/env python3
"""Validate a stage's artifact against its JSON Schema.

The runner calls this after every JSON-producing stage; a stage is not
done until validation passes.

Usage:
    # Validate one stage by key (understanding / evidence / module_plan /
    # pre_render / post_render / learning).
    python tools/validate_artifact.py --story-id 215 --stage evidence

    # Validate every stage that has a schema and an artifact on disk.
    python tools/validate_artifact.py --story-id 215

Exit codes:
    0 — all validations passed
    1 — one or more validations failed
    2 — jsonschema not installed (pip install -r tools/requirements.txt)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.paths import (  # noqa: E402
    STAGE_ARTIFACTS,
    STAGE_SCHEMAS,
    repo_root,
    stage_schema_path,
    story_artifact_path,
)


def _load_validator():
    """Lazy-imported so --help works on a clean checkout."""
    try:
        import jsonschema  # type: ignore
    except ImportError as err:
        print(
            "[validate_artifact] jsonschema not installed. Run:\n"
            "    pip install -r tools/requirements.txt",
            file=sys.stderr,
        )
        raise SystemExit(2) from err
    return jsonschema


def validate_stage(story_id: int, stage_key: str) -> tuple[bool, str]:
    artifact = story_artifact_path(story_id, stage_key)
    schema_path = stage_schema_path(stage_key)
    if schema_path is None:
        return True, f"{stage_key}: no schema (skipped)"
    if not artifact.exists():
        return False, f"{stage_key}: missing artifact {artifact.relative_to(repo_root())}"
    if not schema_path.exists():
        return False, f"{stage_key}: missing schema {schema_path.relative_to(repo_root())}"

    jsonschema = _load_validator()
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        return False, f"{stage_key}: schema is malformed JSON: {err}"
    try:
        payload = json.loads(artifact.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        return False, f"{stage_key}: artifact is malformed JSON: {err}"

    try:
        jsonschema.validate(instance=payload, schema=schema)
    except jsonschema.ValidationError as err:  # type: ignore[attr-defined]
        loc = "/".join(str(p) for p in err.absolute_path) or "(root)"
        return False, f"{stage_key}: invalid at {loc}: {err.message}"

    return True, f"{stage_key}: ok ({artifact.name})"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Validate stage artifacts against their JSON Schemas.",
    )
    ap.add_argument("--story-id", type=int, required=True)
    ap.add_argument("--stage", default=None,
                    choices=sorted(STAGE_SCHEMAS.keys()),
                    help="Stage key to validate. Omit to validate every "
                         "stage that has a schema.")
    args = ap.parse_args()

    stages = [args.stage] if args.stage else sorted(STAGE_SCHEMAS.keys())
    all_ok = True
    for stage in stages:
        ok, msg = validate_stage(args.story_id, stage)
        prefix = "OK  " if ok else "FAIL"
        # Skip "missing artifact" when running the full sweep — Claude
        # may not have produced every stage yet.
        if not ok and not args.stage and "missing artifact" in msg:
            continue
        print(f"[{prefix}] {msg}")
        all_ok = all_ok and ok
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
