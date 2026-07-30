// Geo field conventions:
//   source_country:   ISO 3166-1 alpha-2, lowercase ("gb", "us", "in", ...)
//   source_region:    grouping slug ("western_europe", "north_america", "south_asia", ...)
//   language:         ISO 639-1 lowercase
//   is_global_source: true when the outlet's audience/coverage is meaningfully international
//                     (Reuters/AP/BBC World/Guardian World); false for US/UK-domestic blogs

const RSS_FEEDS = [
  // ── AI ─────────────────────────────────────────────────────────────────────
  // Dedicated AI/ML vertical. Listed FIRST so that for articles also carried by a
  // shared domain's broader feed (techcrunch/theverge/wired/technologyreview/
  // arstechnica/zdnet/livemint/economictimes), the AI sub-feed wins
  // the discover url_hash dedup → the article is tagged `ai` rather than
  // tech/finance. Geo is domain-invariant, so lookupFeedByDomain stays correct.
  //
  // Volume note: synthesis needs ≥2 distinct domains per cluster (cluster_score
  // effectively wants ~3), so breadth of outlets covering the SAME AI event is
  // what turns coverage into stories. We favour AI-dedicated outlets and AI
  // sub-feeds (not broad general-tech feeds) to keep the vertical genuinely AI.

  // AI news outlets & AI sub-feeds
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/",         domain: "techcrunch.com",        category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",     domain: "theverge.com",          category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",   domain: "technologyreview.com",  category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.wired.com/feed/tag/ai/latest/rss",                          domain: "wired.com",             category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://arstechnica.com/ai/feed/",                                      domain: "arstechnica.com",       category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.zdnet.com/topic/artificial-intelligence/rss.xml",           domain: "zdnet.com",             category: "ai", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://www.theregister.com/software/ai_ml/headlines.atom",             domain: "theregister.com",       category: "ai", authority_score: 0.6, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://the-decoder.com/feed/",                                         domain: "the-decoder.com",       category: "ai", authority_score: 0.4, source_country: "de", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.marktechpost.com/feed/",                                    domain: "marktechpost.com",      category: "ai", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.artificialintelligence-news.com/feed/",                     domain: "artificialintelligence-news.com", category: "ai", authority_score: 0.4, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://syncedreview.com/feed/",                                        domain: "syncedreview.com",      category: "ai", authority_score: 0.4, source_country: "ca", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",     domain: "spectrum.ieee.org",     category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.kdnuggets.com/feed",                                        domain: "kdnuggets.com",         category: "ai", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

  // AI company / research blogs (primary-source announcements)
  { url: "https://blog.google/technology/ai/rss/",                                domain: "blog.google",           category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://deepmind.google/blog/rss.xml",                                  domain: "deepmind.google",       category: "ai", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://openai.com/news/rss.xml",                                       domain: "openai.com",            category: "ai", authority_score: 0.8, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://blogs.microsoft.com/ai/feed/",                                  domain: "blogs.microsoft.com",   category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://blogs.nvidia.com/feed/",                                        domain: "blogs.nvidia.com",      category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://huggingface.co/blog/feed.xml",                                  domain: "huggingface.co",        category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://aws.amazon.com/blogs/machine-learning/feed/",                   domain: "aws.amazon.com",        category: "ai", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://news.mit.edu/rss/topic/artificial-intelligence2",               domain: "news.mit.edu",          category: "ai", authority_score: 0.8, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

  // India-origin AI/tech feeds
  { url: "https://www.livemint.com/rss/technology",                               domain: "livemint.com",          category: "ai", authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://inc42.com/feed/",                                               domain: "inc42.com",             category: "ai", authority_score: 0.4, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://yourstory.com/feed/",                                           domain: "yourstory.com",         category: "ai", authority_score: 0.4, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://economictimes.indiatimes.com/tech/rssfeeds/78570530.cms",       domain: "economictimes.indiatimes.com", category: "ai", authority_score: 0.6, source_country: "in", source_region: "south_asia", language: "en", is_global_source: false },
  { url: "https://www.analyticsvidhya.com/feed/",                                 domain: "analyticsvidhya.com",   category: "ai", authority_score: 0.4, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },

  // ── World ──────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml",                   domain: "bbc.com",              category: "world",   authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/world/rss",                         domain: "theguardian.com",      category: "world",   authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.aljazeera.com/xml/rss/all.xml",                     domain: "aljazeera.com",        category: "world",   authority_score: 0.8, source_country: "qa", source_region: "middle_east",    language: "en", is_global_source: true  },
  { url: "https://rss.dw.com/rdf/rss-en-all",                             domain: "dw.com",               category: "world",   authority_score: 0.6, source_country: "de", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.france24.com/en/rss",                               domain: "france24.com",         category: "world",   authority_score: 0.6, source_country: "fr", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://foreignpolicy.com/feed/",                               domain: "foreignpolicy.com",    category: "world",   authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://abcnews.go.com/abcnews/internationalheadlines",         domain: "abcnews.go.com",       category: "world",   authority_score: 0.8, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  // India-origin world feeds
  { url: "https://www.thehindu.com/news/national/feeder/default.rss",     domain: "thehindu.com",         category: "world",   authority_score: 0.8, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://indianexpress.com/feed/",                               domain: "indianexpress.com",    category: "world",   authority_score: 0.8, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", domain: "hindustantimes.com", category: "world",   authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://feeds.feedburner.com/ndtvnews-top-stories",             domain: "ndtv.com",             category: "world",   authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",    domain: "timesofindia.indiatimes.com", category: "world", authority_score: 0.6, source_country: "in", source_region: "south_asia",  language: "en", is_global_source: false },
  { url: "https://feeds.feedburner.com/ScrollinArticles.rss",             domain: "scroll.in",            category: "world",   authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://www.indiatoday.in/rss/home",                            domain: "indiatoday.in",        category: "world",   authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },

  // ── Tech ───────────────────────────────────────────────────────────────────
  { url: "https://feeds.arstechnica.com/arstechnica/index",               domain: "arstechnica.com",      category: "tech",    authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.wired.com/feed/rss",                                domain: "wired.com",            category: "tech",    authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml",              domain: "bbc.com",              category: "tech",    authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/technology/rss",                    domain: "theguardian.com",      category: "tech",    authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://techcrunch.com/feed/",                                  domain: "techcrunch.com",       category: "tech",    authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.engadget.com/rss.xml",                              domain: "engadget.com",         category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://www.zdnet.com/news/rss.xml",                            domain: "zdnet.com",            category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://feeds.feedburner.com/TheHackersNews",                   domain: "thehackernews.com",    category: "tech",    authority_score: 0.4, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: true  },
  { url: "https://www.theverge.com/rss/index.xml",                        domain: "theverge.com",         category: "tech",    authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.technologyreview.com/feed/",                        domain: "technologyreview.com", category: "tech",    authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://9to5mac.com/feed/",                                     domain: "9to5mac.com",          category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://9to5google.com/feed/",                                  domain: "9to5google.com",       category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://www.macrumors.com/macrumors.xml",                       domain: "macrumors.com",        category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://news.ycombinator.com/rss",                              domain: "ycombinator.com",      category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

  // ── Finance ────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml",                domain: "bbc.com",              category: "finance", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/business/rss",                      domain: "theguardian.com",      category: "finance", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/",         domain: "marketwatch.com",      category: "finance", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://fortune.com/feed/",                                     domain: "fortune.com",          category: "finance", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  // India-origin finance feeds
  { url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms",      domain: "economictimes.indiatimes.com", category: "finance", authority_score: 0.6, source_country: "in", source_region: "south_asia", language: "en", is_global_source: false },
  { url: "https://www.livemint.com/rss/news",                             domain: "livemint.com",         category: "finance", authority_score: 0.6, source_country: "in", source_region: "south_asia",     language: "en", is_global_source: false },
  { url: "https://www.thehindubusinessline.com/feeder/default.rss",       domain: "thehindubusinessline.com", category: "finance", authority_score: 0.6, source_country: "in", source_region: "south_asia", language: "en", is_global_source: false },

  // ── Culture ────────────────────────────────────────────────────────────────
  // RETIRED (owner decision 2026-07-30: "no one is interested in culture") — no
  // culture feeds are ingested. The `culture` category id stays in
  // config/categories.js (selectable: false) so historical questions still
  // render. To revive the vertical, restore feeds here (previously: BBC
  // entertainment_and_arts, Guardian /culture/rss, rollingstone.com,
  // variety.com, deadline.com, hollywoodreporter.com, pitchfork.com) and
  // re-add culture to EDITORIAL_MIX + the frontend picker.

  // ── Science ────────────────────────────────────────────────────────────────
  { url: "https://www.nature.com/nature.rss",                             domain: "nature.com",           category: "science", authority_score: 0.6, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.sciencemag.org/rss/news_current.xml",               domain: "science.org",          category: "science", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", domain: "bbc.com",              category: "science", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/science/rss",                       domain: "theguardian.com",      category: "science", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.wired.com/category/science/feed/",                  domain: "wired.com",            category: "science", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://feeds.arstechnica.com/arstechnica/science",             domain: "arstechnica.com",      category: "science", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://www.newscientist.com/feed/home/",                       domain: "newscientist.com",     category: "science", authority_score: 0.6, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://phys.org/rss-feed/",                                    domain: "phys.org",             category: "science", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://www.sciencedaily.com/rss/top/science.xml",              domain: "sciencedaily.com",     category: "science", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
];

// ── Startup validation ────────────────────────────────────────────────────────
// Throws on module load if any feed is missing the four geo fields or uses
// non-canonical casing. Catches typos / forgotten entries at boot rather than
// at first scrape. Lowercase invariants protect the lookupFeedByDomain index
// from silent misses on future mixed-case edits.
const REQUIRED_GEO_FIELDS = ["source_country", "source_region", "language", "is_global_source"];
for (const feed of RSS_FEEDS) {
  for (const field of REQUIRED_GEO_FIELDS) {
    if (feed[field] === undefined || feed[field] === null || feed[field] === "") {
      throw new Error(`rss-feeds.js: feed ${feed.url} is missing required geo field "${field}"`);
    }
  }
  if (typeof feed.domain !== "string" || feed.domain !== feed.domain.toLowerCase()) {
    throw new Error(`rss-feeds.js: feed ${feed.url} domain "${feed.domain}" must be lowercase`);
  }
  if (feed.source_country !== feed.source_country.toLowerCase() || feed.source_country.length !== 2) {
    throw new Error(`rss-feeds.js: feed ${feed.url} source_country "${feed.source_country}" must be lowercase ISO 3166-1 alpha-2`);
  }
  if (feed.language !== feed.language.toLowerCase() || feed.language.length !== 2) {
    throw new Error(`rss-feeds.js: feed ${feed.url} language "${feed.language}" must be lowercase ISO 639-1`);
  }
}

// ── Domain lookup (indexed) ───────────────────────────────────────────────────
// Same domain may appear under multiple categories (e.g. bbc.com). Source
// fields are domain-invariant, so we return the first entry per domain. Keys
// are guaranteed lowercase by the validation pass above, so callers can pass
// any casing safely.
const FEEDS_BY_DOMAIN = new Map();
for (const feed of RSS_FEEDS) {
  if (!FEEDS_BY_DOMAIN.has(feed.domain)) {
    FEEDS_BY_DOMAIN.set(feed.domain, feed);
  }
}

export function lookupFeedByDomain(domain) {
  if (!domain) return null;
  return FEEDS_BY_DOMAIN.get(domain.toLowerCase()) ?? null;
}

export default RSS_FEEDS;
