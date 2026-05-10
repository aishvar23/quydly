// P1-8 — source diversity scoring.
//
// Per docs/data-pipeline-improvements-tracker.md: source_count alone is a
// weak quality signal. "3 sources" could be three Reuters re-prints (low
// diversity) or one wire + one primary filing + one independent reporting
// (high diversity). EvidenceShelf today shows the count without flagging
// the difference.
//
// We score 0-1 weighting two signals:
//   1. distinct domain count (saturates at 5)
//   2. independent-reporting share (non-wire / distinct)
//
// Plus three honest-diversity adjustments (added 2026-05-09 from the v2
// video-pipeline learning record):
//   - sister-site networks collapse to one perspective (9to5 cluster, vox
//     network, etc.). Stage-2 video gate-2b mirrors this.
//   - author concentration ≥75% across articles caps the label at "narrow"
//     (mirrors stage-2 video gate-2a). The score formula stays put so
//     historical numbers remain comparable.
//   - source_country count is reported so downstream rules can detect a
//     single-country source set on a multi-country story (story 181/222).
//
// Pure function — no I/O, no Claude. Called from the synthesizer with the
// articles a cluster snapshotted; result is persisted on the story row.

// Wire / aggregator domains. Stories whose pickup is exclusively wire
// score noticeably below stories where any independent reporter filed.
// The list is intentionally short — drift here makes diversity look
// better than it is. Tracks the global wires plus the largest US/UK /
// Indian aggregators that re-license to many outlets.
const WIRE_DOMAINS = new Set([
  "reuters.com",
  "apnews.com",
  "ap.org",
  "afp.com",
  "bloomberg.com",
  "dpa.com",
  "kyodonews.net",
  "kyodo.com",
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "newswire.ca",
  "pti.in",
  "ptinews.com",
  "ians.in",
  "tass.com",
  "tasr.sk",
  "xinhuanet.com",
  "yonhapnews.co.kr",
]);

// Sister-site networks: domains under a single editorial direction. A
// story whose entire pickup collapses to one of these networks reads as
// "diverse" by raw domain count but is single-perspective in reality.
// First incident: story 215 — 4 articles across 9to5google.com (×3) and
// 9to5mac.com (×1), 3/4 by the same author. Reported source_diversity
// of 0.64 ("diverse") overstated it.
//
// Keep this list short and high-signal. Each entry is the network's
// identifier (used for counting); all domains in the Set collapse to it.
const SISTER_NETWORKS = Object.freeze({
  "9to5_network": new Set([
    "9to5google.com",
    "9to5mac.com",
    "9to5toys.com",
    "electrek.co",
  ]),
  "vox_media": new Set([
    "vox.com",
    "theverge.com",
    "eater.com",
    "sbnation.com",
    "polygon.com",
    "curbed.com",
  ]),
  "vice_media": new Set([
    "vice.com",
    "motherboard.vice.com",
    "i-d.co",
  ]),
  "conde_nast": new Set([
    "wired.com",
    "newyorker.com",
    "gq.com",
    "vanityfair.com",
    "vogue.com",
    "arstechnica.com",
    "pitchfork.com",
    "bonappetit.com",
  ]),
  "future_plc": new Set([
    "techradar.com",
    "tomshardware.com",
    "pcgamer.com",
    "gamesradar.com",
    "creativebloq.com",
  ]),
  // India-cluster: same parent (Times Group) often picks up its own wire.
  "times_india_group": new Set([
    "timesofindia.indiatimes.com",
    "indiatimes.com",
    "economictimes.indiatimes.com",
  ]),
});

// Reduce a domain to its registered base by trimming common subdomains.
// "www.reuters.com" → "reuters.com", "edition.cnn.com" → "cnn.com",
// "in.reuters.com" → "reuters.com". Cheap and tolerant: doesn't try to
// parse country-code TLDs perfectly — just strips the leading subdomain
// when it matches a known noise prefix. Domains that don't match pass
// through unchanged.
//
// Per Codex P2 review on PR #72: a bare domain like "news.com" must NOT
// collapse to "com" when its first label happens to match a noise prefix.
// We only accept the strip when at least one dot remains afterwards
// (i.e. there is still a registrable domain). Otherwise we fall back to
// the original input — a legitimate bare domain stays as itself.
function rootDomain(d) {
  if (!d || typeof d !== "string") return null;
  const lower = d.trim().toLowerCase();
  if (!lower) return null;
  const stripped = lower.replace(/^(?:www|edition|amp|m|mobile|i|news|in|us|uk|ca|au)\./, "");
  if (!stripped.includes(".")) return lower;
  return stripped;
}

function isWire(d) {
  return WIRE_DOMAINS.has(rootDomain(d));
}

// Map a domain root to its sister-network identifier, or return the root
// unchanged if it's not in any registered network. Used to fold sister
// sites into one effective perspective when counting diversity.
function networkOf(rootedDomain) {
  if (!rootedDomain) return null;
  for (const [networkId, members] of Object.entries(SISTER_NETWORKS)) {
    if (members.has(rootedDomain)) return networkId;
  }
  return rootedDomain;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Three-bucket label for at-a-glance editorial reads. Thresholds are
// rounded so the boundary is unambiguous in logs.
function bucketLabel(score) {
  if (score < 0.3) return "single";
  if (score < 0.6) return "narrow";
  return "diverse";
}

// Cap the score-derived label when concentration signals fire. Sister-
// site collapse and same-author concentration both indicate a story
// reads single-perspective regardless of how many domains it spans.
// "single" never gets demoted further; "diverse" demotes to "narrow"
// rather than to "single" (raw score stays).
function applyConcentrationCap(scoreLabel, networkCount, topAuthorShare) {
  if (scoreLabel === "single") return scoreLabel;
  if (networkCount <= 1) return "narrow";
  if (Number.isFinite(topAuthorShare) && topAuthorShare >= 0.75) return "narrow";
  return scoreLabel;
}

/**
 * Compute source diversity for a story from its snapshotted articles.
 *
 * Returns a score plus a coarse label and the underlying counts so callers
 * can log meaningful telemetry. Always returns a valid object — empty /
 * malformed input scores 0 with label "single".
 *
 * @param {Array<{ domain?: string|null, author?: string|null, source_country?: string|null }>} articles
 * @returns {{
 *   score:             number,    // 0-1, three decimal places
 *   label:             "single"|"narrow"|"diverse",
 *   domain_count:      number,    // distinct registered-domain roots
 *   wire_count:        number,    // distinct domains in WIRE_DOMAINS
 *   non_wire_count:    number,    // domain_count - wire_count
 *   network_count:     number,    // distinct editorial networks (sister-collapsed)
 *   country_count:     number,    // distinct non-empty source_country values
 *   top_author_share:  number,    // 0-1; max share of any single author across non-empty authors
 * }}
 */
export function computeSourceDiversity(articles) {
  const list = Array.isArray(articles) ? articles : [];

  const seenDomains  = new Set();
  const seenNetworks = new Set();
  const seenCountries = new Set();
  const authorCounts = new Map();
  let articlesWithAuthor = 0;
  let wire = 0;
  let nonWire = 0;

  for (const a of list) {
    const root = rootDomain(a?.domain);
    if (root && !seenDomains.has(root)) {
      seenDomains.add(root);
      if (WIRE_DOMAINS.has(root)) wire++;
      else nonWire++;
    }
    if (root) {
      seenNetworks.add(networkOf(root));
    }

    const country = typeof a?.source_country === "string" ? a.source_country.trim().toLowerCase() : "";
    if (country) seenCountries.add(country);

    const author = typeof a?.author === "string" ? a.author.trim().toLowerCase() : "";
    if (author) {
      articlesWithAuthor++;
      authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
    }
  }

  const domainCount  = seenDomains.size;
  const networkCount = seenNetworks.size;
  const countryCount = seenCountries.size;

  // Author concentration is computed against articles-with-author, not
  // total articles. A pile of bylined wire pickups should still trigger
  // even if half the articles have no author field at all. Returns 0
  // when there are no usable authors — honest "we don't know" signal.
  let topAuthorShare = 0;
  if (articlesWithAuthor > 0) {
    let maxCount = 0;
    for (const c of authorCounts.values()) if (c > maxCount) maxCount = c;
    topAuthorShare = Number((maxCount / articlesWithAuthor).toFixed(3));
  }

  // Saturation point at 5 distinct domains. Most stories don't exceed
  // that on real Supabase data; raising the cap would push every story
  // under 0.5 by construction.
  const domainDiversity = clamp01(Math.min(domainCount, 5) / 5);

  // Independent share among distinct domains. Single-domain stories
  // collapse to 0/1 (all-wire) or 1/1 (all primary). Stories with no
  // domain data score 0 — honest "we don't know" signal.
  const nonWireShare = domainCount > 0 ? clamp01(nonWire / domainCount) : 0;

  const raw = 0.6 * domainDiversity + 0.4 * nonWireShare;
  const score = Number(raw.toFixed(3));

  const rawLabel = bucketLabel(score);
  const label    = applyConcentrationCap(rawLabel, networkCount, topAuthorShare);

  return {
    score,
    label,
    domain_count:     domainCount,
    wire_count:       wire,
    non_wire_count:   nonWire,
    network_count:    networkCount,
    country_count:    countryCount,
    top_author_share: topAuthorShare,
  };
}

// Re-exported for tests and any future consumer that needs to classify a
// single domain without paying the full computeSourceDiversity cost.
export { WIRE_DOMAINS, SISTER_NETWORKS, rootDomain, isWire, networkOf };
