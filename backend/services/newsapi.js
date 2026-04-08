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
  const url = `${API_URL}&pageSize=${pageSize}&apiKey=${process.env.NEWSAPI_KEY}`;

  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NewsAPI error ${res.status}`);
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
