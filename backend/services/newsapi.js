/**
 * NewsAPI.org client — Quydly
 *
 * Fetches top headlines from a curated set of sources.
 * All articles are tagged as "world" since NewsAPI does not provide
 * category data compatible with our internal taxonomy.
 */

const API_URL =
  "https://newsapi.org/v2/top-headlines" +
  "?sources=bbc-news,reuters,associated-press,al-jazeera-english,axios,bloomberg," +
  "business-insider,financial-times,fortune,google-news,independent," +
  "the-wall-street-journal,the-washington-post,time,usa-today,wired," +
  "the-verge,techcrunch,ars-technica,hacker-news,new-scientist,next-big-future";

/**
 * Fetch top headlines from NewsAPI.org.
 * Returns articles in the same shape as fetchAllHeadlines() from newsdata.js.
 *
 * @param {number} pageSize — Max articles to request (NewsAPI cap: 100)
 * @returns {Promise<object[]>}
 */
export async function fetchNewsApiHeadlines(pageSize = 100) {
  const key = process.env.NEWSAPI_KEY;
  console.log(`[newsapi] NEWSAPI_KEY present: ${!!key}, length: ${key?.length ?? 0}, preview: ${key ? key.slice(0, 6) + "..." : "MISSING"}`);
  console.log(`[newsapi] process.env keys available: ${Object.keys(process.env).filter(k => k.startsWith("NEWS")).join(", ") || "(none matching NEWS*)"}`);
  console.log(`[newsapi] cwd: ${process.cwd()}`);

  if (!key) {
    console.warn("[newsapi] NEWSAPI_KEY is not set — skipping NewsAPI fetch");
    return [];
  }

  const url = `${API_URL}&pageSize=${pageSize}&apiKey=${key}`;

  let json;
  try {
    const res = await fetch(url);
    console.log(`[newsapi] response status: ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.warn(`[newsapi] fetch failed — HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    json = await res.json();
  } catch (err) {
    console.warn(`[newsapi] fetch failed — ${err.message}`);
    return [];
  }

  const articles = (json.articles ?? [])
    .filter((a) => a.title && (a.description || a.content))
    .map((a) => ({
      title: a.title,
      description: a.description ?? null,
      content: a.content ?? null,
      link: a.url ?? null,
      categories: ["world"],
    }));

  console.log(`[newsapi] fetched ${articles.length} articles`);
  return articles;
}
