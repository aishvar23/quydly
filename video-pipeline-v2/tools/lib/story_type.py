"""Deterministic story_type inference.

Mirrors the "Pick by walking these checks in order. Stop at the first
match." rule from `video-learning/prompts/01-story-understanding.md`.

This is intentionally rule-based, not LLM-based: the prepare step needs
a stable answer so the same story always lands in the same template.
Claude can override at stage 1 if the inference was wrong — this is a
seed, not a verdict.

Returns one of: legal-scandal, geopolitics, finance, conflict, policy,
tech, service-journalism, or "unknown".

The `service-journalism` sentinel is a rejection signal — it means the
story matches the retail-deals / affiliate-aggregation pattern flagged
by the synth (editorial_posture='disclosure_official' + quality_flags
+ quiz_candidate=false). Callers should refuse workspace creation when
this is returned; see `tools/process_story.py` exit code 5.

Schemas this knows about:
    legal-scandal, geopolitics, finance, tech     — templates exist
    conflict, policy                              — templates do not exist yet;
                                                    inference still returns the
                                                    right answer so the operator
                                                    knows what to add
    service-journalism                            — rejection sentinel; no
                                                    template; caller must stop
"""
from __future__ import annotations

import re
from typing import Any


# Bodies whose presence in primary_entities signals a legal-scandal story.
_LEGAL_BODIES = {
    "doj", "department of justice",
    "sec", "securities and exchange commission",
    "ftc", "federal trade commission",
    "cftc",
    "usao", "u.s. attorney",
    "sdny", "edny", "ndca", "dc district court",
    "european commission",  # antitrust enforcement
    "european court of justice",
}

# Tokens whose presence in primary_entities or category signals tech.
_TECH_TOKENS = {
    "openai", "anthropic", "google deepmind", "meta ai", "microsoft",
    "apple", "nvidia", "amd", "intel", "tsmc", "samsung",
    "cloudflare", "amazon web services", "aws", "azure", "gcp",
}

# Bodies whose presence signals policy (regulator / legislature / court).
_POLICY_BODIES = {
    "fcc", "epa", "fda", "fhfa", "cdc", "nhtsa",
    "house of representatives", "senate", "congress",
    "supreme court", "federal judge", "circuit court",
    "european parliament", "european council",
}

# Central banks + major public-issuer financial institutions whose name
# typically appears without a corporate suffix. Pairs with the corporate-
# suffix scan below to approximate prompts/01-story-understanding.md
# rule 4's "public company or central bank in primary_entities" gate.
_FINANCE_ENTITIES = {
    "federal reserve", "the fed", "fomc",
    "ecb", "european central bank",
    "bank of england", "boe",
    "bank of japan", "boj",
    "people's bank of china", "pboc",
    "reserve bank of india", "rbi",
    "reserve bank of australia", "rba",
    "swiss national bank", "snb",
    "bank of canada", "boc",
    "bank for international settlements", "bis",
    "goldman sachs", "morgan stanley", "jpmorgan", "j.p. morgan",
    "bank of america", "citigroup", "wells fargo", "hsbc",
    "blackrock", "vanguard", "berkshire hathaway",
    "nyse", "nasdaq", "lse", "london stock exchange",
}

# Substrings that indicate a corporate issuer when they appear at the
# *end* of a primary_entities entry (lowercased, with leading space).
# Endswith semantics — not raw substring — so "International Atomic
# Energy Agency" does not match " ag" the way Volkswagen AG does.
# Trailing periods on the entity are stripped before the check.
_PUBLIC_COMPANY_SUFFIX_TOKENS = (
    " inc", " corp", " corporation",
    " ltd", " limited",
    " plc", " ag", " s.a", " n.v",
    " holdings", " & co",
)


# Word-boundary regex for finance entities. Built once at import time.
# `_FINANCE_ENTITIES` is lowercased; entries are escaped and sorted
# longest-first so multi-word phrases ("federal reserve") match before
# shorter ones ("the fed"). The `(?:^|\W)` / `(?:\W|$)` anchors prevent
# acronym tokens like "bis" matching inside "bishop" or "boe" matching
# inside "boeing".
_FINANCE_ENTITY_PATTERN = re.compile(
    r"(?:^|\W)(?:"
    + "|".join(re.escape(e) for e in sorted(_FINANCE_ENTITIES, key=len, reverse=True))
    + r")(?:\W|$)"
)


def _lower_strs(values: Any) -> list[str]:
    """Pull strings from primary_entities, primary_entities_enriched, or
    raw lists; lowercase for matching. Tolerates missing / malformed
    fields — the seed should never crash on a synth-side schema dip."""
    out: list[str] = []
    if not values:
        return out
    for item in values:
        if isinstance(item, str):
            out.append(item.lower())
        elif isinstance(item, dict):
            name = item.get("name") or item.get("entity") or ""
            if isinstance(name, str) and name:
                out.append(name.lower())
    return out


def _entities_contain(row: dict[str, Any], tokens: set[str]) -> bool:
    """Case-insensitive presence test across primary_entities and
    primary_entities_enriched."""
    haystack = (
        _lower_strs(row.get("primary_entities"))
        + _lower_strs(row.get("primary_entities_enriched"))
    )
    blob = " | ".join(haystack)
    return any(token in blob for token in tokens)


def _has_finance_entity(row: dict[str, Any]) -> bool:
    """Approximate the prompt's 'public company or central bank in
    primary_entities' gate. Returns True when an entity matches the
    central-bank / major-issuer list as a whole word or phrase, OR
    when an entity ends with a corporate suffix.

    Boundary-aware: avoids false positives like 'International Atomic
    Energy Agency' matching ' ag' (caught by Codex review on PR #88)."""
    haystack = (
        _lower_strs(row.get("primary_entities"))
        + _lower_strs(row.get("primary_entities_enriched"))
    )
    if not haystack:
        return False
    blob = " | ".join(haystack)
    if _FINANCE_ENTITY_PATTERN.search(blob):
        return True
    for entity in haystack:
        stripped = entity.rstrip(" .,;)")
        if any(stripped.endswith(suffix) for suffix in _PUBLIC_COMPANY_SUFFIX_TOKENS):
            return True
    return False


def _has_casualty_signal(row: dict[str, Any]) -> bool:
    """Casualty stories carry explicit casualty fields or units in
    structured_numbers. We're conservative — false negatives here are
    fine because the operator can correct."""
    posture = (row.get("editorial_posture") or "").lower()
    if posture == "tally_official":
        # Combined with a military / casualty signal in key_points.
        kp = " ".join(row.get("key_points") or []).lower()
        if any(w in kp for w in ("killed", "wounded", "casualt", "strike", "shelling")):
            return True
    nums = row.get("structured_numbers") or {}
    if isinstance(nums, dict):
        # structured_numbers is a payload with known sub-keys; check the
        # casualty-bearing one if present.
        casualties = nums.get("casualties") or nums.get("killed") or []
        if casualties:
            return True
    return False


def infer_story_type(row: dict[str, Any]) -> str:
    """Walk the rule set. Stop at first match. Return 'unknown' if no
    rule fires — caller should escalate, not pick a default."""
    posture = (row.get("editorial_posture") or "").lower()
    category = (row.get("category_id") or "").lower()

    # 0. Service-journalism early-reject (mirrors prompts/01-story-
    #    understanding.md step 0). When the synth has tagged the story
    #    as a vendor / retailer disclosure AND flagged it as numeric-
    #    trivia AND declined it for the quiz, refuse before workspace
    #    creation. Caller is `tools/process_story.py`; exit code 5.
    quality_flags = row.get("quality_flags") or []
    if not isinstance(quality_flags, list):
        quality_flags = []
    quiz_candidate = row.get("quiz_candidate")
    if (
        posture == "disclosure_official"
        and "NUMERIC_TRIVIA_RISK" in quality_flags
        and quiz_candidate is False
    ):
        return "service-journalism"

    # 1. Legal-scandal: regulator/prosecutor in entities, charging or
    #    enforcement-style posture.
    if _entities_contain(row, _LEGAL_BODIES):
        kp = " ".join(row.get("key_points") or []).lower()
        legal_words = ("charged", "indicted", "convicted", "settled",
                       "pleaded", "fined", "sentenced", "lawsuit", "complaint")
        if any(w in kp for w in legal_words):
            return "legal-scandal"

    # 2. Conflict: tally_official + casualty signal, OR breaking_developing
    #    with casualty signal.
    if _has_casualty_signal(row):
        return "conflict"

    # 3. Policy: regulator / legislature / court entity AND posture
    #    indicates a rule change / ruling.
    if _entities_contain(row, _POLICY_BODIES):
        if posture == "policy_move":
            return "policy"
        kp = " ".join(row.get("key_points") or []).lower()
        if any(w in kp for w in ("ruled", "approved", "voted", "rule", "regulation")):
            return "policy"

    # 4. Tech: tech category OR named tech vendor.
    if category in {"tech", "business/tech"} or _entities_contain(row, _TECH_TOKENS):
        return "tech"

    # 5. Finance: mirrors prompts/01-story-understanding.md rule 4 —
        # primary_entities has a public company or central bank AND the
        # hook is a number with a unit. market_move posture is treated as
        # an unconditional positive signal. Without a finance entity,
        # a lone money/percentage entry is insufficient — story 224
        # (Trump/Hormuz pause) carried a single gasoline-+50% percentage
        # but is geopolitical; the entity gate stops that mis-classification.
    if posture == "market_move":
        return "finance"
    nums = row.get("structured_numbers") or {}
    if isinstance(nums, dict) and _has_finance_entity(row):
        money = nums.get("money") or []
        pcts = nums.get("percentages") or []
        if money or pcts:
            return "finance"

    # 6. Geopolitics: world category with state-level entities.
    if category == "world":
        # If we got here, none of the more specific rules fired. Treat as
        # geopolitics provisionally.
        return "geopolitics"

    return "unknown"
