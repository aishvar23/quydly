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

/**
 * Compute source diversity for a story from its snapshotted articles.
 *
 * Returns a score plus a coarse label and the underlying counts so callers
 * can log meaningful telemetry. Always returns a valid object — empty /
 * malformed input scores 0 with label "single".
 *
 * @param {Array<{ domain?: string|null }>} articles
 * @returns {{
 *   score:           number,    // 0-1, three decimal places
 *   label:           "single"|"narrow"|"diverse",
 *   domain_count:    number,    // distinct registered-domain roots
 *   wire_count:      number,    // distinct domains in WIRE_DOMAINS
 *   non_wire_count:  number,    // domain_count - wire_count
 * }}
 */
export function computeSourceDiversity(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const seen = new Set();
  let wire = 0;
  let nonWire = 0;
  for (const a of list) {
    const root = rootDomain(a?.domain);
    if (!root) continue;
    if (seen.has(root)) continue;
    seen.add(root);
    if (WIRE_DOMAINS.has(root)) wire++;
    else nonWire++;
  }
  const domainCount = seen.size;

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

  return {
    score,
    label:          bucketLabel(score),
    domain_count:   domainCount,
    wire_count:     wire,
    non_wire_count: nonWire,
  };
}

// Re-exported for tests and any future consumer that needs to classify a
// single domain without paying the full computeSourceDiversity cost.
export { WIRE_DOMAINS, rootDomain, isWire };
