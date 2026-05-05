"""Thin wrapper around supabase-py.

The Supabase client is created lazily on first use and reused across
calls within a process. We intentionally do *not* duplicate the column
list from `src/integrations/supabase.js` — for the learning side we
fetch every column with `select("*")`, then let the consumers (Claude,
the prompts) pick what they need from the row.

Required env vars:
    SUPABASE_URL          full project URL, e.g. https://abc.supabase.co
    SUPABASE_SERVICE_KEY  service-role key (NOT the anon key)

The service key is required because we read tables that have RLS enabled.
Never put the service key in a client-side bundle or commit it.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

# supabase-py and its dotenv helper are imported lazily so that --help
# works without the dependencies installed.
_client: Any = None


class SupabaseConfigError(RuntimeError):
    """Raised when the env vars Supabase needs are missing or empty."""


def _load_dotenv_if_present(repo_root: Path) -> None:
    """Best-effort .env load. We don't fail if python-dotenv isn't there;
    the user may have set the vars some other way."""
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)


def get_client() -> Any:
    """Return a cached supabase-py client. Raises SupabaseConfigError if
    the env vars are missing — callers can catch and present a friendly
    message."""
    global _client
    if _client is not None:
        return _client

    # Late import: the package is only installed via tools/requirements.txt
    # and we want --help to work on a clean checkout.
    try:
        from supabase import create_client  # type: ignore
    except ImportError as err:
        raise SupabaseConfigError(
            "supabase-py is not installed. Run:\n"
            "    pip install -r tools/requirements.txt"
        ) from err

    # Try .env from the repo root as a convenience.
    from .paths import repo_root
    _load_dotenv_if_present(repo_root())

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        raise SupabaseConfigError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the\n"
            "environment or in .env at the repo root. See .env.example."
        )

    _client = create_client(url, key)
    return _client


def fetch_story_row(story_id: int) -> dict[str, Any]:
    """Fetch the `stories` row by id. Returns the row dict.

    Raises:
        SupabaseConfigError: env vars missing.
        LookupError: no row with that id.
        RuntimeError: any other Supabase error.
    """
    client = get_client()
    resp = (
        client.table("stories")
        .select("*")
        .eq("id", story_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise LookupError(f"story {story_id} not found in `stories` table")
    return rows[0]


def fetch_cluster(cluster_id: int | None) -> dict[str, Any] | None:
    """Fetch the cluster row tied to a story. Returns None if cluster_id
    is null or the row is missing — both are recoverable; callers decide
    whether to warn or proceed."""
    if not cluster_id:
        return None
    client = get_client()
    resp = (
        client.table("clusters")
        .select("*")
        .eq("id", cluster_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def fetch_raw_articles(article_ids: list[int]) -> list[dict[str, Any]]:
    """Fetch raw_articles rows for the ids referenced by a cluster.

    The cluster's `article_ids` is the join key; `raw_articles` itself
    has no cluster_id column on every row in this schema (it varies by
    pipeline version — using the cluster's array is the stable path).

    Returns rows ordered by authority_score descending so the highest-
    credibility source leads.
    """
    if not article_ids:
        return []
    client = get_client()
    resp = (
        client.table("raw_articles")
        .select("*")
        .in_("id", article_ids)
        .order("authority_score", desc=True)
        .execute()
    )
    return resp.data or []
