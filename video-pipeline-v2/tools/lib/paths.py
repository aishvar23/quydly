"""Canonical path helpers.

All other scripts derive paths from here, so renames stay localised. The
repo root is the directory that contains the `video-learning/` folder —
this convention lets the tools work whether they're invoked from the
repo root or from inside `tools/`.
"""
from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    """Return the video-pipeline-v2 repo root.

    The root is the directory containing `video-learning/`. We walk up from
    this file's location until we find it. This makes the scripts robust
    to being invoked from any working directory.
    """
    here = Path(__file__).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "video-learning").is_dir():
            return candidate
    # Fallback: assume tools/lib/paths.py → tools/lib → tools → repo root.
    return here.parents[2]


# --- Top-level directories --------------------------------------------------

def stories_root() -> Path:
    """Where each story's workspace lives, one folder per story id."""
    return repo_root() / "stories"


def video_learning_root() -> Path:
    """The system brain: playbook, prompts, templates, learning index."""
    return repo_root() / "video-learning"


def templates_dir() -> Path:
    return video_learning_root() / "templates"


def prompts_dir() -> Path:
    return video_learning_root() / "prompts"


def playbook_dir() -> Path:
    return video_learning_root() / "playbook"


def learning_dir() -> Path:
    """Lazy-created on first update_learning.py run."""
    return video_learning_root() / "learning"


def schemas_dir() -> Path:
    return video_learning_root() / "schemas"


def approved_examples_dir() -> Path:
    return video_learning_root() / "approved-examples"


# Stage key → schema filename (only stages that have a JSON Schema).
# Keys match those in STAGE_ARTIFACTS below.
STAGE_SCHEMAS: dict[str, str] = {
    "understanding":  "story-understanding.schema.json",
    "evidence":       "evidence-package.schema.json",
    "module_plan":    "module-plan.schema.json",
    "pre_render":     "render-review.schema.json",
    "post_render":    "render-review.schema.json",
    "learning":       "learning-record.schema.json",
}


def stage_schema_path(stage_key: str) -> Path | None:
    name = STAGE_SCHEMAS.get(stage_key)
    if not name:
        return None
    return schemas_dir() / name


def display_path(path: Path) -> str:
    """Format a path for log output.

    Returns it relative to repo_root() when possible, else the absolute
    path. Workspaces inside the repo print as short relative paths; external
    workspaces passed via --story-folder (e.g. /tmp/scratch-story-215) print
    the full path rather than crashing on Path.relative_to.
    """
    try:
        return str(path.relative_to(repo_root()))
    except ValueError:
        return str(path)


# --- Per-story paths --------------------------------------------------------

def story_dir(story_id: int | str) -> Path:
    return stories_root() / str(story_id)


def story_artifact(story_id: int | str, name: str) -> Path:
    return story_dir(story_id) / name


# Canonical artifact filenames per stage. Keep in sync with the prompts
# under `video-learning/prompts/`.
STAGE_ARTIFACTS: dict[str, str] = {
    "source":             "story.json",
    "template":           "template.json",
    "meta":               "_meta.json",
    "understanding":      "01_understanding.json",
    "evidence":           "02_evidence.json",
    "script":             "03_script.md",
    "module_plan":        "04_module-plan.json",
    "pre_render":         "05_pre-render-critique.json",
    "render_output":      "06_render-output",
    "post_render":        "07_post-render-critique.json",
    "learning":           "08_learning.json",
}


# Files that must exist after stage 8 for update_learning.py to consider
# the story complete. `script` and beyond are skipped if stage 2 returned
# `status: "insufficient"`.
ARTIFACTS_REQUIRED_BASE = ["source", "template", "meta", "understanding", "evidence"]
ARTIFACTS_REQUIRED_FULL = ARTIFACTS_REQUIRED_BASE + [
    "script", "module_plan", "pre_render", "post_render", "learning",
]


def story_artifact_path(story_id: int | str, key: str) -> Path:
    """Resolve a stage key (e.g. 'understanding') to its full path."""
    return story_artifact(story_id, STAGE_ARTIFACTS[key])
