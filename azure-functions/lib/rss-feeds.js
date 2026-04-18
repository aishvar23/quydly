// Geo field conventions:
//   source_country:   ISO 3166-1 alpha-2, lowercase ("gb", "us", "in", ...)
//   source_region:    grouping slug ("western_europe", "north_america", "south_asia", ...)
//   language:         ISO 639-1 lowercase
//   is_global_source: true when the outlet's audience/coverage is meaningfully international
//                     (Reuters/AP/BBC World/Guardian World); false for US/UK-domestic blogs

const RSS_FEEDS = [
  // ── World ──────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml",                   domain: "bbc.com",              category: "world",   authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/world/rss",                         domain: "theguardian.com",      category: "world",   authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.aljazeera.com/xml/rss/all.xml",                     domain: "aljazeera.com",        category: "world",   authority_score: 0.8, source_country: "qa", source_region: "middle_east",    language: "en", is_global_source: true  },
  { url: "https://rss.dw.com/rdf/rss-en-all",                             domain: "dw.com",               category: "world",   authority_score: 0.6, source_country: "de", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.france24.com/en/rss",                               domain: "france24.com",         category: "world",   authority_score: 0.6, source_country: "fr", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://foreignpolicy.com/feed/",                               domain: "foreignpolicy.com",    category: "world",   authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://abcnews.go.com/abcnews/internationalheadlines",         domain: "abcnews.go.com",       category: "world",   authority_score: 0.8, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

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
  { url: "https://feeds.feedburner.com/venturebeat/SZYF",                 domain: "venturebeat.com",      category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://news.ycombinator.com/rss",                              domain: "ycombinator.com",      category: "tech",    authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

  // ── Finance ────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml",                domain: "bbc.com",              category: "finance", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/business/rss",                      domain: "theguardian.com",      category: "finance", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/",         domain: "marketwatch.com",      category: "finance", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },
  { url: "https://fortune.com/feed/",                                     domain: "fortune.com",          category: "finance", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: true  },

  // ── Culture ────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",  domain: "bbc.com",              category: "culture", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.theguardian.com/culture/rss",                       domain: "theguardian.com",      category: "culture", authority_score: 0.8, source_country: "gb", source_region: "western_europe", language: "en", is_global_source: true  },
  { url: "https://www.rollingstone.com/music/music-news/feed/",           domain: "rollingstone.com",     category: "culture", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://variety.com/feed/",                                     domain: "variety.com",          category: "culture", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://deadline.com/feed/",                                    domain: "deadline.com",         category: "culture", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://www.hollywoodreporter.com/feed/",                       domain: "hollywoodreporter.com",category: "culture", authority_score: 0.6, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },
  { url: "https://pitchfork.com/rss/news/",                               domain: "pitchfork.com",        category: "culture", authority_score: 0.4, source_country: "us", source_region: "north_america",  language: "en", is_global_source: false },

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
// Throws on module load if any feed is missing the four geo fields. Catches
// typos / forgotten entries at boot rather than at first scrape.
const REQUIRED_GEO_FIELDS = ["source_country", "source_region", "language", "is_global_source"];
for (const feed of RSS_FEEDS) {
  for (const field of REQUIRED_GEO_FIELDS) {
    if (feed[field] === undefined || feed[field] === null || feed[field] === "") {
      throw new Error(`rss-feeds.js: feed ${feed.url} is missing required geo field "${field}"`);
    }
  }
}

// ── Domain lookup (indexed) ───────────────────────────────────────────────────
// Same domain may appear under multiple categories (e.g. bbc.com). Source
// fields are domain-invariant, so we return the first entry per domain.
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
