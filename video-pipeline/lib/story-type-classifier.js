'use strict';

const TYPE_KEYWORDS = {
  legal_scandal: [
    'fraud', 'charged', 'indicted', 'arrested', 'classified', 'corruption',
    'scandal', 'theft', 'wire fraud', 'commodities', 'charges', 'insider',
    'conspiracy', 'plea', 'sentence', 'indictment', 'prosecutor',
  ],
  geopolitics_world: [
    'military', 'war', 'conflict', 'sanctions', 'troops', 'operation',
    'nato', 'invasion', 'ceasefire', 'airstrike', 'diplomat', 'treaty',
    'missile', 'defense', 'foreign minister', 'geopolitics',
  ],
  finance_markets: [
    'market', 'stock', 'economy', 'inflation', 'gdp', 'investment',
    'federal reserve', 'interest rate', 'earnings', 'recession', 'trade',
    'tariff', 'bank', 'fund', 'shares', 'ceo', 'merger', 'acquisition',
  ],
  tech_cyber: [
    'ai', 'artificial intelligence', 'technology', 'launch', 'product',
    'app', 'software', 'chip', 'model', 'data breach', 'cybersecurity',
    'hacker', 'ransomware', 'vulnerability',
  ],
};

function classifyStory(story) {
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ').toLowerCase();
  const scores = {};
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    scores[type] = keywords.filter(kw => matchesWord(corpus, kw)).length;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'general';
}

function matchesWord(corpus, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`).test(corpus);
}

module.exports = { classifyStory };
