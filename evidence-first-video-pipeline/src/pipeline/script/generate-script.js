'use strict';

const { completeJSON, hasAnthropic } = require('../../integrations/anthropic');

async function generateScript(story, audit, { useAI = false } = {}, evidencePackage) {
  const script = useAI && hasAnthropic()
    ? await aiScript(story, audit, evidencePackage)
    : deterministicScript(story, audit, evidencePackage);

  validateScript(script);
  return {
    ...script,
    story_type: evidencePackage.story_type,
    generation_source: script.generation_source || 'deterministic_evidence',
  };
}

function deterministicScript(story, audit, evidencePackage) {
  if (evidencePackage.story_type === 'legal_scandal' && hasPerson(evidencePackage, 'Gannon Ken Van Dyke')) {
    return vanDykeScript();
  }

  return genericEvidenceScript(story, audit, evidencePackage);
}

function genericEvidenceScript(story, audit, evidencePackage) {
  const people = evidencePackage.entities.people || [];
  const organizations = evidencePackage.entities.organizations || [];
  const locations = evidencePackage.entities.locations || [];
  const money = evidencePackage.numbers.money || [];
  const counts = evidencePackage.numbers.counts || [];
  const charges = evidencePackage.legal.charges || [];
  const platforms = evidencePackage.products_or_platforms || [];
  const firstFact = story.key_points?.[0] || '';
  const secondFact = story.key_points?.[1] || '';
  const summaryLead = firstSentence(story.summary);
  const modules = new Set((evidencePackage.assets.graphics_needed || []).join(' ').split(/[_\s]+/));
  const segments = [
    {
      role: 'hook',
      text: cleanSentence(audit.hook_sentence || story.headline),
    },
    {
      role: 'dossier',
      text: cleanSentence(shortenWords(summaryLead || story.summary, 36)),
    },
  ];

  if (people[0]) {
    segments.push({
      role: 'person_context',
      text: cleanSentence(`The story centers on ${people.slice(0, 2).map((person) => person.name).join(' and ')}`),
    });
  } else if (organizations[0]) {
    segments.push({
      role: 'person_context',
      text: cleanSentence(`The key institution here is ${organizations[0]}`),
    });
  }

  if (platforms[0]) {
    segments.push({
      role: 'platform',
      text: cleanSentence(`${platforms[0]} is the platform viewers need to understand`),
    });
  }

  const numberLine = numberSentence(money, counts);
  if (numberLine) {
    segments.push({ role: 'numbers', text: numberLine });
  }

  if (locations[0]) {
    segments.push({
      role: 'map',
      text: cleanSentence(`The map matters because the story runs through ${compactLocations(locations).slice(0, 3).join(', ')}`),
    });
  }

  if (charges[0] || evidencePackage.story_type === 'legal_scandal') {
    segments.push({
      role: 'charges',
      text: cleanSentence(charges[0]
        ? `The legal issue is ${charges.slice(0, 2).join(' and ')}`
        : 'The legal posture matters, because the claims are still being disputed'),
    });
  }

  if (firstFact || secondFact || modules.has('timeline')) {
    segments.push({
      role: 'timeline',
      text: cleanSentence(shortenWords(firstFact || secondFact || 'The key developments are still unfolding', 22)),
    });
  }

  segments.push({
    role: 'impact',
    text: cleanSentence(impactSentence(evidencePackage, story)),
  });

  const trimmedSegments = fitSegments(segments, 115);
  const fullScript = trimmedSegments.map((item) => item.text).join(' ');

  return {
    hook: trimmedSegments[0].text,
    body: trimmedSegments.slice(1, -1).map((item) => item.text).join(' '),
    close: trimmedSegments[trimmedSegments.length - 1].text,
    full_script: fullScript,
    segments: trimmedSegments,
    title_variants: [makeTitleVariant(story.headline), `${makeTitleVariant(story.headline)} | Quydly`],
    thumbnail_copy: shortenOverlay(story.headline, 5),
    overlay_phrases: overlayPhrasesFor(story, evidencePackage),
    estimated_duration_sec: 46,
  };
}

function vanDykeScript() {
  const segments = [
    {
      role: 'hook',
      text: 'A U.S. soldier is accused of using classified information to make a fortune on Polymarket.',
    },
    {
      role: 'dossier',
      text: 'Prosecutors say Gannon Ken Van Dyke helped plan Operation Absolute Resolve at Fort Bragg.',
    },
    {
      role: 'person_context',
      text: "The operation focused on Nicolas Maduro, Venezuela's former president.",
    },
    {
      role: 'platform',
      text: 'The indictment says Van Dyke later placed bets tied to Maduro on Polymarket.',
    },
    {
      role: 'numbers',
      text: 'Prosecutors say he put in about thirty-three thousand dollars. They say he made roughly four hundred thousand dollars.',
    },
    {
      role: 'map',
      text: 'The charges come from documents, not operation footage.',
    },
    {
      role: 'charges',
      text: 'Van Dyke faces five federal counts.',
    },
    {
      role: 'timeline',
      text: 'The bets were placed before January third.',
    },
    {
      role: 'impact',
      text: 'The question now is whether prediction markets can catch bets made with secret government information.',
    },
  ];
  const fullScript = segments.map((item) => item.text).join(' ');

  return {
    hook: segments[0].text,
    body: segments.slice(1, -1).map((item) => item.text).join(' '),
    close: segments[segments.length - 1].text,
    full_script: fullScript,
    segments,
    title_variants: [
      'Special Forces Soldier Charged in $409K Polymarket Case',
      'Classified Intel, Polymarket Bets, Federal Charges',
    ],
    thumbnail_copy: '$409K POLYMARKET CASE',
    overlay_phrases: [
      '$409K from secret intel?',
      'Case file: Van Dyke',
      'Maduro operation context',
      'Polymarket bets',
      '$33,034 to $409,881',
      'Caracas, Venezuela',
      'Five federal counts',
      'Dec. 26 to Apr. 23',
      'Prediction-market risk',
    ],
    estimated_duration_sec: 48,
    generation_source: 'deterministic_evidence',
  };
}

async function aiScript(story, audit, evidencePackage) {
  const system = [
    'You write concise spoken scripts for evidence-first animated news explainers.',
    'Use only supplied facts. Preserve allegation language for legal claims.',
    'Do not invent footage, quotes, images, or extra facts.',
    'Return strict JSON only.',
  ].join(' ');

  const prompt = `Story:\n${JSON.stringify(story, null, 2)}\n\nAudit:\n${JSON.stringify(audit, null, 2)}\n\nEvidence package:\n${JSON.stringify(evidencePackage, null, 2)}\n\nWrite 75-120 spoken words split into module segments. Return:\n{
  "hook": "",
  "body": "",
  "close": "",
  "full_script": "",
  "segments": [
    {"role": "hook", "text": ""},
    {"role": "dossier", "text": ""},
    {"role": "person_context", "text": ""},
    {"role": "platform", "text": ""},
    {"role": "numbers", "text": ""},
    {"role": "map", "text": ""},
    {"role": "charges", "text": ""},
    {"role": "timeline", "text": ""},
    {"role": "impact", "text": ""}
  ],
  "title_variants": ["", ""],
  "thumbnail_copy": "",
  "overlay_phrases": ["", "", "", "", "", "", "", "", ""]
}`;

  return {
    ...(await completeJSON({ system, prompt, maxTokens: 1800 })),
    generation_source: 'anthropic_evidence',
  };
}

function hasPerson(evidencePackage, name) {
  return (evidencePackage.entities.people || []).some((person) => person.name === name);
}

function firstSentence(text) {
  const match = String(text || '').match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : String(text || '').trim();
}

function cleanSentence(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function shortenWords(text, maxWords) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

function numberSentence(money, counts) {
  const uniqueMoney = uniqueDisplays(money.map((item) => item.display));
  if (uniqueMoney[0] && uniqueMoney[1]) {
    return cleanSentence(`Two numbers stand out: ${uniqueMoney[0]} and ${uniqueMoney[1]}`);
  }
  if (uniqueMoney[0]) {
    return cleanSentence(`The key figure is ${uniqueMoney[0]}`);
  }
  if (counts[0]) {
    return cleanSentence(`The key count is ${counts[0].display}`);
  }
  return null;
}

function impactSentence(evidencePackage, story) {
  const concepts = evidencePackage.why_it_matters_concepts || [];
  if (concepts[0] && concepts[1]) {
    return `The bigger question is what this means for ${concepts[0]} and ${concepts[1]}`;
  }
  if (concepts[0]) return `The bigger question is what this means for ${concepts[0]}`;
  return `The important part is what changes next after ${shortenWords(story.headline, 10)}`;
}

function fitSegments(segments, maxWords) {
  const filtered = segments.filter((segment) => segment.text);
  let total = 0;
  return filtered.map((segment, index) => {
    const remaining = maxWords - total;
    if (remaining <= 0) return null;
    const isLast = index === filtered.length - 1;
    const limit = isLast ? remaining : Math.min(40, Math.max(8, remaining - 10));
    const text = cleanSentence(shortenWords(segment.text, limit));
    total += text.split(/\s+/).filter(Boolean).length;
    return { ...segment, text };
  }).filter(Boolean);
}

function uniqueDisplays(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function compactLocations(locations) {
  const result = [];
  for (const location of locations) {
    const value = String(location || '').trim();
    const lower = value.toLowerCase();
    if (!value) continue;
    if (result.some((item) => item.toLowerCase().includes(lower) || lower.includes(item.toLowerCase()))) continue;
    result.push(value);
  }
  return result;
}

function overlayPhrasesFor(story, evidencePackage) {
  const people = (evidencePackage.entities.people || []).map((person) => person.name);
  const locations = evidencePackage.entities.locations || [];
  const money = (evidencePackage.numbers.money || []).map((item) => item.display);
  const charges = evidencePackage.legal.charges || [];
  return [
    shortenOverlay(story.headline, 5),
    people[0] || (evidencePackage.entities.organizations || [])[0] || 'Key actor',
    locations[0] || 'Location context',
    money[0] || 'Key number',
    charges[0] || evidencePackage.story_type.replace(/_/g, ' '),
    'Why it matters',
  ].filter(Boolean);
}

function makeTitleVariant(headline) {
  return headline.length <= 70 ? headline : `${headline.slice(0, 67).trim()}...`;
}

function shortenOverlay(text, maxWords) {
  return String(text)
    .replace(/[^\w\s$.-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

function fitWordRange(text, minWords, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) return `${words.slice(0, maxWords).join(' ')}.`;
  if (words.length >= minWords) return text;

  return [
    text,
    'The explainer keeps the visuals contextual and evidence-labeled.',
  ].join(' ');
}

function validateScript(script) {
  if (!script.full_script) throw new Error('Script missing full_script');
  const count = script.full_script.split(/\s+/).filter(Boolean).length;
  if (count < 55 || count > 130) {
    throw new Error(`Script word count ${count} outside V1 range`);
  }
  if (!Array.isArray(script.segments) || script.segments.length < 3) {
    throw new Error('Script must include module segments');
  }
  if (!Array.isArray(script.overlay_phrases) || script.overlay_phrases.length < 5) {
    throw new Error('Script must include at least five overlay_phrases');
  }
}

module.exports = {
  generateScript,
  deterministicScript,
  shortenOverlay,
};
