const API_BASE = "https://newsdata.io/api/1/news";

/**
 * Fetch the top headline for a given NewsData.io category tag.
 * Returns { title, description } or throws on failure.
 */
async function fetchHeadline(newsDataTag) {
  const url = new URL(API_BASE);
  url.searchParams.set("apikey", process.env.NEWSDATA_API_KEY);
  url.searchParams.set("language", "en");
  url.searchParams.set("category", newsDataTag);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`NewsData API error ${res.status} for tag "${newsDataTag}"`);
  }

  const json = await res.json();
  const articles = json.results ?? [];

  // Find first article that has both title and description
  const article = articles.find((a) => a.title && a.description);
  if (!article) {
    throw new Error(`No usable headline found for tag "${newsDataTag}"`);
  }

  return { title: article.title, description: article.description };
}

module.exports = { fetchHeadline };
