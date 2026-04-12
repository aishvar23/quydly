// Phase 2.2 — RSS feed registry
// Schema: { url, domain, category, authority_score }
// authority_score: Reuters/AP = 1.0, BBC/NYT/Guardian = 0.8,
//                  Ars/Wired/Nature = 0.6, Engadget/ZDNet = 0.4
//
// Dead feeds removed (2026-04-10):
//   feeds.reuters.com/* — subdomain gone (DNS ENOTFOUND)
//   apnews.com/rss, apnews.com/apf-business — AP dropped public RSS
//   wsj.com RSS — 401 paywall
//   forbes.com/money/feed/ — 404
//   vulture.com/feed/ — 404
//   smithsonianmag.com/rss/ — 403
//   arts.gov feed — 404
//   scientificamerican.com/feed/ — 404
//   nationalgeographic.com RSS — TLS error
//   discovermagazine.com/rss — 403
//   politico.com RSS — 403
//   dw.com/rss/rss.xml — 404 (moved to rss.dw.com)
//   rss.france24.com — ENOTFOUND (moved to france24.com/en/rss)
//
// Paywalled/blocked domains removed (2026-04-12): RSS discovery works but
// article scraping always fails. BBC/Guardian/Al Jazeera/DW/Ars cover the
// same stories openly.
//   nytimes.com (world, tech, finance, culture, science) — 403 on all articles
//   washingtonpost.com (world) — bot-detection timeout on all articles
//   economist.com (world, finance) — 403 on all articles
//   bloomberg.com (finance) — 403 on all articles
//   ft.com (world, finance) — 403 on all articles
//   npr.org (world, finance, culture) — JS-heavy pages, timeout on all articles
//   skynews.com (world) — timeout on all articles

const RSS_FEEDS = [
  // ── World ──────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml",                   domain: "bbc.com",              category: "world",   authority_score: 0.8 },
  { url: "https://www.theguardian.com/world/rss",                         domain: "theguardian.com",      category: "world",   authority_score: 0.8 },
  { url: "https://www.aljazeera.com/xml/rss/all.xml",                     domain: "aljazeera.com",        category: "world",   authority_score: 0.8 },
  { url: "https://rss.dw.com/rdf/rss-en-all",                             domain: "dw.com",               category: "world",   authority_score: 0.6 },
  { url: "https://www.france24.com/en/rss",                               domain: "france24.com",         category: "world",   authority_score: 0.6 },
  { url: "https://foreignpolicy.com/feed/",                               domain: "foreignpolicy.com",    category: "world",   authority_score: 0.6 },
  { url: "https://abcnews.go.com/abcnews/internationalheadlines",         domain: "abcnews.go.com",       category: "world",   authority_score: 0.8 },

  // ── Tech ───────────────────────────────────────────────────────────────────
  { url: "https://feeds.arstechnica.com/arstechnica/index",               domain: "arstechnica.com",      category: "tech",    authority_score: 0.6 },
  { url: "https://www.wired.com/feed/rss",                                domain: "wired.com",            category: "tech",    authority_score: 0.6 },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml",              domain: "bbc.com",              category: "tech",    authority_score: 0.8 },
  { url: "https://www.theguardian.com/technology/rss",                    domain: "theguardian.com",      category: "tech",    authority_score: 0.8 },
  { url: "https://techcrunch.com/feed/",                                  domain: "techcrunch.com",       category: "tech",    authority_score: 0.6 },
  { url: "https://www.engadget.com/rss.xml",                              domain: "engadget.com",         category: "tech",    authority_score: 0.4 },
  { url: "https://www.zdnet.com/news/rss.xml",                            domain: "zdnet.com",            category: "tech",    authority_score: 0.4 },
  { url: "https://feeds.feedburner.com/TheHackersNews",                   domain: "thehackernews.com",    category: "tech",    authority_score: 0.4 },
  { url: "https://www.theverge.com/rss/index.xml",                        domain: "theverge.com",         category: "tech",    authority_score: 0.6 },
  { url: "https://www.technologyreview.com/feed/",                        domain: "technologyreview.com", category: "tech",    authority_score: 0.6 },
  { url: "https://9to5mac.com/feed/",                                     domain: "9to5mac.com",          category: "tech",    authority_score: 0.4 },
  { url: "https://9to5google.com/feed/",                                  domain: "9to5google.com",       category: "tech",    authority_score: 0.4 },
  { url: "https://www.macrumors.com/macrumors.xml",                       domain: "macrumors.com",        category: "tech",    authority_score: 0.4 },
  { url: "https://feeds.feedburner.com/venturebeat/SZYF",                 domain: "venturebeat.com",      category: "tech",    authority_score: 0.4 },
  { url: "https://news.ycombinator.com/rss",                              domain: "ycombinator.com",      category: "tech",    authority_score: 0.4 },

  // ── Finance ────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml",                domain: "bbc.com",              category: "finance", authority_score: 0.8 },
  { url: "https://www.theguardian.com/business/rss",                      domain: "theguardian.com",      category: "finance", authority_score: 0.8 },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/",         domain: "marketwatch.com",      category: "finance", authority_score: 0.6 },
  { url: "https://fortune.com/feed/",                                     domain: "fortune.com",          category: "finance", authority_score: 0.6 },

  // ── Culture ────────────────────────────────────────────────────────────────
  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",  domain: "bbc.com",              category: "culture", authority_score: 0.8 },
  { url: "https://www.theguardian.com/culture/rss",                       domain: "theguardian.com",      category: "culture", authority_score: 0.8 },
  { url: "https://www.rollingstone.com/music/music-news/feed/",           domain: "rollingstone.com",     category: "culture", authority_score: 0.6 },
  { url: "https://variety.com/feed/",                                     domain: "variety.com",          category: "culture", authority_score: 0.6 },
  { url: "https://deadline.com/feed/",                                    domain: "deadline.com",         category: "culture", authority_score: 0.6 },
  { url: "https://www.hollywoodreporter.com/feed/",                       domain: "hollywoodreporter.com",category: "culture", authority_score: 0.6 },
  { url: "https://pitchfork.com/rss/news/",                               domain: "pitchfork.com",        category: "culture", authority_score: 0.4 },

  // ── Science ────────────────────────────────────────────────────────────────
  { url: "https://www.nature.com/nature.rss",                             domain: "nature.com",           category: "science", authority_score: 0.6 },
  { url: "https://www.sciencemag.org/rss/news_current.xml",               domain: "science.org",          category: "science", authority_score: 0.6 },
  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", domain: "bbc.com",              category: "science", authority_score: 0.8 },
  { url: "https://www.theguardian.com/science/rss",                       domain: "theguardian.com",      category: "science", authority_score: 0.8 },
  { url: "https://www.wired.com/category/science/feed/",                  domain: "wired.com",            category: "science", authority_score: 0.6 },
  { url: "https://feeds.arstechnica.com/arstechnica/science",             domain: "arstechnica.com",      category: "science", authority_score: 0.6 },
  { url: "https://www.newscientist.com/feed/home/",                       domain: "newscientist.com",     category: "science", authority_score: 0.6 },
  { url: "https://phys.org/rss-feed/",                                    domain: "phys.org",             category: "science", authority_score: 0.4 },
  { url: "https://www.sciencedaily.com/rss/top/science.xml",              domain: "sciencedaily.com",     category: "science", authority_score: 0.4 },
];

export default RSS_FEEDS;
