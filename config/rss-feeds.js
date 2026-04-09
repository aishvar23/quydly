// Phase 2.2 — RSS feed registry
// Schema: { url, domain, category, authority_score }
// authority_score: Reuters/AP = 1.0, BBC/NYT/Guardian = 0.8,
//                  Ars/Wired/Nature = 0.6, Engadget/ZDNet = 0.4

const RSS_FEEDS = [
  // ── World ──────────────────────────────────────────────────────────────────
  { url: "https://feeds.reuters.com/reuters/topNews",                     domain: "reuters.com",          category: "world",   authority_score: 1.0 },
  { url: "https://feeds.reuters.com/Reuters/worldNews",                   domain: "reuters.com",          category: "world",   authority_score: 1.0 },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",        domain: "nytimes.com",          category: "world",   authority_score: 0.8 },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml",                   domain: "bbc.com",              category: "world",   authority_score: 0.8 },
  { url: "https://www.theguardian.com/world/rss",                         domain: "theguardian.com",      category: "world",   authority_score: 0.8 },
  { url: "https://apnews.com/rss",                                        domain: "apnews.com",           category: "world",   authority_score: 1.0 },
  { url: "https://www.aljazeera.com/xml/rss/all.xml",                     domain: "aljazeera.com",        category: "world",   authority_score: 0.8 },
  { url: "https://feeds.washingtonpost.com/rss/world",                    domain: "washingtonpost.com",   category: "world",   authority_score: 0.8 },
  { url: "https://www.economist.com/the-world-this-week/rss.xml",         domain: "economist.com",        category: "world",   authority_score: 0.8 },
  { url: "https://www.dw.com/rss/rss.xml",                                domain: "dw.com",               category: "world",   authority_score: 0.6 },
  { url: "https://rss.france24.com/en/top-stories/rss",                   domain: "france24.com",         category: "world",   authority_score: 0.6 },
  { url: "https://feeds.skynews.com/feeds/rss/world.xml",                 domain: "skynews.com",          category: "world",   authority_score: 0.6 },
  { url: "https://www.politico.com/rss/politics08.xml",                   domain: "politico.com",         category: "world",   authority_score: 0.6 },
  { url: "https://feeds.npr.org/1004/rss.xml",                            domain: "npr.org",              category: "world",   authority_score: 0.8 },
  { url: "https://www.ft.com/world?format=rss",                           domain: "ft.com",               category: "world",   authority_score: 0.8 },
  { url: "https://foreignpolicy.com/feed/",                               domain: "foreignpolicy.com",    category: "world",   authority_score: 0.6 },

  // ── Tech ───────────────────────────────────────────────────────────────────
  { url: "https://feeds.arstechnica.com/arstechnica/index",               domain: "arstechnica.com",      category: "tech",    authority_score: 0.6 },
  { url: "https://www.wired.com/feed/rss",                                domain: "wired.com",            category: "tech",    authority_score: 0.6 },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",   domain: "nytimes.com",          category: "tech",    authority_score: 0.8 },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml",              domain: "bbc.com",              category: "tech",    authority_score: 0.8 },
  { url: "https://www.theguardian.com/technology/rss",                    domain: "theguardian.com",      category: "tech",    authority_score: 0.8 },
  { url: "https://techcrunch.com/feed/",                                  domain: "techcrunch.com",       category: "tech",    authority_score: 0.6 },
  { url: "https://www.engadget.com/rss.xml",                              domain: "engadget.com",         category: "tech",    authority_score: 0.4 },
  { url: "https://www.zdnet.com/news/rss.xml",                            domain: "zdnet.com",            category: "tech",    authority_score: 0.4 },
  { url: "https://feeds.feedburner.com/TheHackersNews",                   domain: "thehackernews.com",    category: "tech",    authority_score: 0.4 },
  { url: "https://www.theverge.com/rss/index.xml",                        domain: "theverge.com",         category: "tech",    authority_score: 0.6 },
  { url: "https://feeds.reuters.com/reuters/technologyNews",              domain: "reuters.com",          category: "tech",    authority_score: 1.0 },
  { url: "https://www.technologyreview.com/feed/",                        domain: "technologyreview.com", category: "tech",    authority_score: 0.6 },
  { url: "https://9to5mac.com/feed/",                                     domain: "9to5mac.com",          category: "tech",    authority_score: 0.4 },
  { url: "https://9to5google.com/feed/",                                  domain: "9to5google.com",       category: "tech",    authority_score: 0.4 },
  { url: "https://www.macrumors.com/macrumors.xml",                       domain: "macrumors.com",        category: "tech",    authority_score: 0.4 },
  { url: "https://feeds.feedburner.com/venturebeat/SZYF",                 domain: "venturebeat.com",      category: "tech",    authority_score: 0.4 },

  // ── Finance ────────────────────────────────────────────────────────────────
  { url: "https://feeds.reuters.com/reuters/businessNews",                domain: "reuters.com",          category: "finance", authority_score: 1.0 },
  { url: "https://www.ft.com/rss/home/uk",                                domain: "ft.com",               category: "finance", authority_score: 0.8 },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",     domain: "nytimes.com",          category: "finance", authority_score: 0.8 },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml",                domain: "bbc.com",              category: "finance", authority_score: 0.8 },
  { url: "https://www.theguardian.com/business/rss",                      domain: "theguardian.com",      category: "finance", authority_score: 0.8 },
  { url: "https://www.wsj.com/xml/rss/3_7085.xml",                        domain: "wsj.com",              category: "finance", authority_score: 0.8 },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/",         domain: "marketwatch.com",      category: "finance", authority_score: 0.6 },
  { url: "https://feeds.bloomberg.com/markets/news.rss",                  domain: "bloomberg.com",        category: "finance", authority_score: 0.8 },
  { url: "https://fortune.com/feed/",                                     domain: "fortune.com",          category: "finance", authority_score: 0.6 },
  { url: "https://www.forbes.com/money/feed/",                            domain: "forbes.com",           category: "finance", authority_score: 0.6 },
  { url: "https://feeds.washingtonpost.com/rss/business",                 domain: "washingtonpost.com",   category: "finance", authority_score: 0.8 },
  { url: "https://www.economist.com/finance-and-economics/rss.xml",       domain: "economist.com",        category: "finance", authority_score: 0.8 },
  { url: "https://apnews.com/apf-business",                               domain: "apnews.com",           category: "finance", authority_score: 1.0 },

  // ── Culture ────────────────────────────────────────────────────────────────
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml",         domain: "nytimes.com",          category: "culture", authority_score: 0.8 },
  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",  domain: "bbc.com",              category: "culture", authority_score: 0.8 },
  { url: "https://www.theguardian.com/culture/rss",                       domain: "theguardian.com",      category: "culture", authority_score: 0.8 },
  { url: "https://www.rollingstone.com/music/music-news/feed/",           domain: "rollingstone.com",     category: "culture", authority_score: 0.6 },
  { url: "https://variety.com/feed/",                                     domain: "variety.com",          category: "culture", authority_score: 0.6 },
  { url: "https://deadline.com/feed/",                                    domain: "deadline.com",         category: "culture", authority_score: 0.6 },
  { url: "https://www.hollywoodreporter.com/feed/",                       domain: "hollywoodreporter.com",category: "culture", authority_score: 0.6 },
  { url: "https://pitchfork.com/rss/news/",                               domain: "pitchfork.com",        category: "culture", authority_score: 0.4 },
  { url: "https://www.vulture.com/feed/",                                 domain: "vulture.com",          category: "culture", authority_score: 0.4 },
  { url: "https://www.npr.org/rss/rss.php?id=1008",                       domain: "npr.org",              category: "culture", authority_score: 0.8 },
  { url: "https://www.smithsonianmag.com/rss/",                           domain: "smithsonianmag.com",   category: "culture", authority_score: 0.6 },
  { url: "https://www.arts.gov/news/press-releases/feed",                 domain: "arts.gov",             category: "culture", authority_score: 0.6 },

  // ── Science ────────────────────────────────────────────────────────────────
  { url: "https://www.nature.com/nature.rss",                             domain: "nature.com",           category: "science", authority_score: 0.6 },
  { url: "https://www.sciencemag.org/rss/news_current.xml",               domain: "science.org",          category: "science", authority_score: 0.6 },
  { url: "https://feeds.reuters.com/reuters/scienceNews",                 domain: "reuters.com",          category: "science", authority_score: 1.0 },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",      domain: "nytimes.com",          category: "science", authority_score: 0.8 },
  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", domain: "bbc.com",              category: "science", authority_score: 0.8 },
  { url: "https://www.theguardian.com/science/rss",                       domain: "theguardian.com",      category: "science", authority_score: 0.8 },
  { url: "https://www.wired.com/category/science/feed/",                  domain: "wired.com",            category: "science", authority_score: 0.6 },
  { url: "https://feeds.arstechnica.com/arstechnica/science",             domain: "arstechnica.com",      category: "science", authority_score: 0.6 },
  { url: "https://www.newscientist.com/feed/home/",                       domain: "newscientist.com",     category: "science", authority_score: 0.6 },
  { url: "https://phys.org/rss-feed/",                                    domain: "phys.org",             category: "science", authority_score: 0.4 },
  { url: "https://www.scientificamerican.com/feed/",                      domain: "scientificamerican.com",category: "science", authority_score: 0.6 },
  { url: "https://feeds.nationalgeographic.com/ng/news/rss/",             domain: "nationalgeographic.com",category: "science", authority_score: 0.6 },
  { url: "https://www.discovermagazine.com/rss",                          domain: "discovermagazine.com", category: "science", authority_score: 0.4 },
];

export default RSS_FEEDS;
