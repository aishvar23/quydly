"""Sister-site groupings for stage-2 publishability gate-2b.

Each group is a set of domain roots that share editorial leadership.
Sources from inside one group are treated as a single perspective for
the purposes of `02-evidence-package.md` § Publishability decision
gate-2b ('single editorial network').

Append-only — when a new sister-site group is identified, add it here
rather than editing existing groups. Each group must list ≥2 domains;
single-domain entries belong in the standard gate-2 ('single domain
root') check.

Resolution is on the registered domain (TLD-2). `9to5google.com` and
`9to5mac.com` resolve to themselves; subdomains are normalised by
stripping a leading `www.`.
"""
from __future__ import annotations


# ----------------------------------------------------------------------------
# Sister-site groups. Add new entries; do not edit existing ones in place.
# ----------------------------------------------------------------------------

NETWORKS: list[set[str]] = [
    # 9to5 Network — formerly 9to5Mac LLC; shared "Lunch Break" affiliate
    # editorial structure across all properties.
    {
        "9to5google.com",
        "9to5mac.com",
        "9to5toys.com",
        "electrek.co",
    },
    # Vox Media — shared editorial leadership and CMS.
    {
        "vox.com",
        "theverge.com",
        "polygon.com",
        "sbnation.com",
        "eater.com",
        "curbed.com",
        "vulture.com",
    },
    # Vice Media Group.
    {
        "vice.com",
        "motherboard.vice.com",
        "i-d.co",
        "refinery29.com",
    },
    # Conde Nast — selected English-language tech / culture titles.
    {
        "wired.com",
        "arstechnica.com",
        "newyorker.com",
        "vanityfair.com",
        "gq.com",
    },
]


def _normalise(domain: str) -> str:
    """Lowercase + strip leading `www.`. Returns empty string for falsy
    inputs so callers can group with .get(...) safely."""
    if not domain:
        return ""
    d = domain.strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d


def network_id(domain: str) -> int | None:
    """Return the index of the network this domain belongs to, or None
    if the domain is not in any registered sister-site group."""
    d = _normalise(domain)
    if not d:
        return None
    for idx, group in enumerate(NETWORKS):
        if d in group:
            return idx
    return None


def all_share_one_network(domains: list[str]) -> bool:
    """True iff every domain in the list resolves to the same network.

    Used by stage-2 gate-2b. A single domain root is the gate-2 case;
    this check is for >1 distinct domain that nevertheless collapse to
    one editorial network.
    """
    if not domains:
        return False
    ids: list[int | None] = [network_id(d) for d in domains]
    if any(i is None for i in ids):
        return False  # at least one domain is independent
    return len(set(ids)) == 1
