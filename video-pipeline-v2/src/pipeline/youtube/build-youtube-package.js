'use strict';

const fs = require('fs');
const path = require('path');
const { getAccentColor } = require('../../shared/brand');

// Build the YouTube publication artifacts that ride alongside the MP4:
//   - thumbnail-props.json   — props consumed by the Thumbnail composition
//   - thumbnail.png          — actual rendered thumbnail (1280x720)
//   - title.txt              — single-line YouTube title
//   - description.md         — full description with sources + hashtags
//   - sources.md             — structured source list with URLs
//
// Title generation is deterministic for now: pick the longest sub-60-char
// variant the script produced. AI-generated YouTube-optimized titles are
// a follow-up — the existing title_variants are usable.
//
// Description structure:
//   1. Hook line (1 sentence — pulls the viewer)
//   2. Body (2-3 sentences explaining the story)
//   3. "What this means for you" — pulled from impact_items
//   4. Timestamps (per module)
//   5. Sources (numbered list with URLs)
//   6. Hashtags
//   7. Brand line + standard CTA

function buildYoutubePackage(storyPackage, outputDir) {
  const youtubeDir = path.join(outputDir, 'youtube');
  fs.mkdirSync(youtubeDir, { recursive: true });

  const story = storyPackage.story || {};
  const script = storyPackage.script || {};
  const evidence = storyPackage.evidencePackage || {};
  const modules = storyPackage.modules || [];
  const storyType = script.story_type || story.story_type || 'general';
  const accentColor = getAccentColor(storyType);
  const publishedDate = formatPublishedDate(story.published_at);

  // 1. Title
  const title = pickTitle(script);

  // 2. Description
  const description = buildDescription({
    storyType, story, script, evidence, modules,
  });

  // 3. Sources
  const sourcesMd = buildSourcesMarkdown(evidence.source_documents || []);

  // 4. Thumbnail props
  const thumbnailProps = buildThumbnailProps({
    storyType, accentColor, story, script, evidence, modules, publishedDate,
  });

  const titlePath = path.join(youtubeDir, 'title.txt');
  const descriptionPath = path.join(youtubeDir, 'description.md');
  const sourcesPath = path.join(youtubeDir, 'sources.md');
  const propsPath = path.join(youtubeDir, 'thumbnail-props.json');

  fs.writeFileSync(titlePath, title + '\n', 'utf8');
  fs.writeFileSync(descriptionPath, description, 'utf8');
  fs.writeFileSync(sourcesPath, sourcesMd, 'utf8');
  fs.writeFileSync(propsPath, JSON.stringify(thumbnailProps, null, 2), 'utf8');

  return {
    youtubeDir,
    titlePath,
    descriptionPath,
    sourcesPath,
    thumbnailPropsPath: propsPath,
    thumbnailProps,
    title,
  };
}

// ─── Title ──────────────────────────────────────────────────────────────────

function pickTitle(script) {
  const variants = Array.isArray(script.title_variants) ? script.title_variants : [];
  const candidates = variants
    .map((v) => String(v || '').trim())
    .filter((v) => v.length > 0 && v.length <= 90);

  if (candidates.length === 0) {
    return script.hook
      ? truncate(String(script.hook), 90)
      : 'Untitled story';
  }

  // Prefer titles between 45 and 70 chars (YouTube sweet spot for search +
  // emotion). Fall back to the longest sub-90 candidate.
  const inSweetSpot = candidates.filter((v) => v.length >= 45 && v.length <= 70);
  if (inSweetSpot.length > 0) {
    return inSweetSpot[0];
  }
  return candidates.reduce((best, v) => (v.length > best.length ? v : best), candidates[0]);
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// ─── Description ────────────────────────────────────────────────────────────

function buildDescription({ storyType, story, script, evidence, modules }) {
  const lines = [];

  // 1. One-line emotional hook (the spoken hook segment is usually a clean
  //    one-liner; otherwise fall back to the headline).
  const hook = (script.hook && String(script.hook).trim())
    || story.headline
    || 'A story update from Quydly.';
  lines.push(hook);
  lines.push('');

  // 2. Body — 2-3 sentences of plain explanation. Use script.body when
  //    present (most story types now produce it).
  if (script.body) {
    lines.push(String(script.body).trim());
    lines.push('');
  }

  // 3. What this means for you — pulled from impact_items
  const impactItems = Array.isArray(script.impact_items) ? script.impact_items : [];
  if (impactItems.length > 0) {
    lines.push('🎯 WHAT THIS MEANS FOR YOU');
    for (const item of impactItems) {
      const who = String(item.who || '').trim();
      const effect = String(item.effect || '').trim();
      if (effect) {
        lines.push(`• ${who ? who + ': ' : ''}${effect}`);
      }
    }
    lines.push('');
  }

  // 4. Timestamps per module — helps YouTube parse chapters
  if (modules.length > 0) {
    lines.push('⏱️ CHAPTERS');
    for (const m of modules) {
      const start = formatTimestamp(m.startSec || 0);
      const label = labelFor(m);
      lines.push(`${start} — ${label}`);
    }
    lines.push('');
  }

  // 5. Sources
  const sources = evidence.source_documents || [];
  if (sources.length > 0) {
    lines.push('📰 SOURCES');
    sources.forEach((src, i) => {
      const title = String(src.title || src.type || 'Filing').trim();
      const issuer = src.issuer ? ` (${src.issuer})` : '';
      const date = src.date ? ` — ${src.date}` : '';
      const url = src.url ? `\n   ${src.url}` : '';
      lines.push(`${i + 1}. ${title}${issuer}${date}${url}`);
    });
    lines.push('');
  }

  // 6. Hashtags — picked by story type
  const hashtags = pickHashtags(storyType, story);
  if (hashtags.length > 0) {
    lines.push(hashtags.map((t) => `#${t}`).join(' '));
    lines.push('');
  }

  // 7. Brand line + CTA
  lines.push('— QUYDLY: Know the story. Keep the receipts.');
  lines.push('Subscribe for daily explainer videos that respect your time.');

  return lines.join('\n');
}

function labelFor(module) {
  const role = module.role || 'segment';
  const overlay = String(module.overlayText || '').trim();
  const map = {
    hook: 'The hook',
    numbers: 'The numbers',
    quote: 'On the record',
    map: 'The setting',
    timeline: 'How it unfolded',
    charges: 'The charges',
    dossier: 'Who is involved',
    evidence_shelf: 'The receipts',
    impact: 'What it means for you',
  };
  return overlay || map[role] || role.replace(/_/g, ' ');
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pickHashtags(storyType, story) {
  const base = ['Quydly', 'NewsExplained', 'Shorts'];
  const map = {
    legal_scandal:        ['Justice', 'FederalCase', 'Indictment'],
    geopolitics_world:    ['WorldNews', 'Geopolitics'],
    finance_markets:      ['FederalReserve', 'Markets', 'Inflation', 'PersonalFinance', 'Mortgage'],
    election_result:      ['Elections', 'Politics'],
    natural_disaster:     ['News', 'Weather'],
    tech_cyber:           ['Cybersecurity', 'Tech'],
    culture_entertainment:['Entertainment', 'Culture'],
    general:              ['News'],
  };
  const lane = map[storyType] || [];
  // Topic hints from key entities (e.g. "FederalReserve" already covers this)
  const entityTags = (story.primary_entities || [])
    .map((e) => String(e || '').replace(/[^a-z0-9]/gi, ''))
    .filter((e) => e.length > 2 && e.length < 22)
    .slice(0, 2);
  return [...new Set([...lane, ...entityTags, ...base])];
}

// ─── Sources file ───────────────────────────────────────────────────────────

function buildSourcesMarkdown(sources) {
  if (!sources || sources.length === 0) {
    return '# Sources\n\nNo sources attached to this story.\n';
  }
  const lines = ['# Sources', ''];
  sources.forEach((src, i) => {
    const num = i + 1;
    const title = String(src.title || src.type || 'Filing').trim();
    const issuer = src.issuer ? String(src.issuer).trim() : '';
    const date = src.date ? String(src.date).trim() : '';
    const url = src.url ? String(src.url).trim() : '';
    const type = src.type ? String(src.type).trim() : '';
    lines.push(`## ${num}. ${title}`);
    if (issuer) lines.push(`- **Issuer:** ${issuer}`);
    if (type) lines.push(`- **Type:** ${type}`);
    if (date) lines.push(`- **Date:** ${date}`);
    if (url) lines.push(`- **URL:** ${url}`);
    lines.push('');
  });
  return lines.join('\n');
}

// ─── Thumbnail props ────────────────────────────────────────────────────────

// Lane-driven. For finance, pick the rate figure as bigNumber, the change
// as the badge, the impact items as the right-column slots. Falls back to
// a generic layout for other lanes until each lane gets its own builder.
function buildThumbnailProps({
  storyType, accentColor, story, script, evidence, modules, publishedDate,
}) {
  const builder = THUMBNAIL_BUILDERS[storyType] || buildGenericThumbnail;
  const props = builder({ story, script, evidence, modules });
  return {
    accentColor,
    brandName: 'QUYDLY',
    publishedDate: publishedDate || null,
    bottomText: 'WHAT IT MEANS FOR YOU',
    ...props,
  };
}

const THUMBNAIL_BUILDERS = {
  finance_markets: buildFinanceThumbnail,
  legal_scandal:   buildLegalScandalThumbnail,
};

function buildFinanceThumbnail({ story, script, evidence, modules }) {
  const detectedAction = evidence.metadata?.detected_action || 'market move';
  const numModule = modules.find((m) => m.role === 'numbers');
  const bigNumber = (numModule && numModule.data && numModule.data.primary)
    || (evidence.numbers?.rates || [])[0]?.display
    || (evidence.numbers?.money || [])[0]?.display
    || 'NEWS';
  const numLabel = numModule?.data?.primaryLabel || '';

  // Change figure: prefer the basis-point or "change"-role rate over
  // a secondary rate figure (which is usually inflation/unemployment,
  // not the actual policy change). Falls back to a count-based badge
  // ("3 IN A ROW") when no change figure is available.
  const rates = evidence.numbers?.rates || [];
  const counts = evidence.numbers?.counts || [];
  const changeRate = rates.find((r) => r.role === 'change');
  const isCut = /cut|drop|ease|lower/i.test(detectedAction);
  const isHike = /hike|raise|tighten/i.test(detectedAction);
  const arrow = isCut ? '↓' : isHike ? '↑' : '•';
  let changeBadge = '';
  if (changeRate) {
    changeBadge = `${arrow} ${changeRate.display.replace(/basis points?/i, 'BPS')}`;
  } else if (counts[0]?.display) {
    changeBadge = `${counts[0].display} IN A ROW`;
  }
  const mainIcon = isCut ? 'down' : isHike ? 'up' : 'scales';

  // Top text: short hook from script.hook_context or story-derived
  const topText = pickFinanceTopText({ detectedAction, script, story });

  const impactItems = Array.isArray(script.impact_items) ? script.impact_items : [];
  const impactSlots = impactItems.slice(0, 3).map((item) => ({
    icon: item.icon || iconForWho(item.who || ''),
    label: shortLabelFor(item.who || '').toUpperCase(),
  }));

  return {
    topText,
    bigNumber,
    bigNumberLabel: numLabel,
    changeBadge,
    mainIcon,
    impactSlots,
  };
}

function pickFinanceTopText({ detectedAction, script, story }) {
  const map = {
    'rate cut':  'RATES JUST DROPPED',
    'rate hike': 'RATES JUST WENT UP',
    'rate hold': 'RATES HELD STEADY',
    'inflation reading': 'INFLATION READING',
    'jobs report': 'NEW JOBS REPORT',
    'M&A deal':  'BIG DEAL ANNOUNCED',
    'IPO':       'NEW IPO',
    'earnings report': 'EARNINGS DROPPED',
  };
  return map[detectedAction] || (story.headline ? truncate(String(story.headline).toUpperCase(), 28) : 'MARKETS UPDATE');
}

function shortLabelFor(who) {
  const w = String(who).toLowerCase();
  if (/mortgage|home/.test(w)) return 'Mortgage';
  if (/savings?|piggy|deposit/.test(w)) return 'Savings';
  if (/credit|card|debt/.test(w)) return 'Debt';
  if (/job|employ|labor/.test(w)) return 'Jobs';
  if (/groce|shop|inflation/.test(w)) return 'Spending';
  // Fallback: use first 2 words
  const words = String(who).replace(/^if you /i, '').split(/\s+/).slice(0, 2).join(' ');
  return words || 'You';
}

function iconForWho(who) {
  const w = String(who).toLowerCase();
  if (/mortgage|home|hous/.test(w)) return 'house';
  if (/savings?|piggy|deposit/.test(w)) return 'piggy';
  if (/credit|card|debt|loan/.test(w)) return 'credit';
  if (/job|employ|work|labor/.test(w)) return 'briefcase';
  if (/groce|shop|price|inflation/.test(w)) return 'shopping';
  return 'dollar';
}

function buildLegalScandalThumbnail({ story, script, evidence, modules }) {
  // Defendant + alleged amount as the focus
  const defendant = evidence.legal?.defendant || '';
  const lastName = defendant.split(/\s+/).slice(-1)[0] || '';
  const amount = (evidence.numbers?.money || [])[0]?.display || '';
  const charges = evidence.legal?.charges || [];

  return {
    topText: lastName ? `${lastName.toUpperCase()} CHARGED` : 'FEDERAL CASE',
    bigNumber: amount || `${charges.length || ''}`.trim(),
    bigNumberLabel: amount ? 'ALLEGED TAKE' : (charges.length ? 'COUNTS' : ''),
    changeBadge: charges.length ? `${charges.length} COUNTS` : '',
    mainIcon: 'scales',
    impactSlots: [
      { icon: 'scales',  label: 'INDICTMENT' },
      { icon: 'dollar',  label: 'MONEY FLOW' },
      { icon: 'capitol', label: 'FEDERAL' },
    ],
  };
}

function buildGenericThumbnail({ story, script }) {
  return {
    topText: 'STORY UPDATE',
    bigNumber: '',
    bigNumberLabel: truncate(String(story.headline || ''), 60),
    changeBadge: '',
    mainIcon: 'scales',
    impactSlots: [],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPublishedDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch (_) {
    return null;
  }
}

module.exports = {
  buildYoutubePackage,
};
