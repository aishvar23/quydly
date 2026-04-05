const API_BASE = "https://newsdata.io/api/1/latest";

/**
 * Fetch a single page of headlines from NewsData.io.
 */
async function fetchPage(newsDataTag, size, nextPageToken = null) {
  const url = new URL(API_BASE);
  url.searchParams.set("apikey", process.env.NEWSDATA_API_KEY);
  url.searchParams.set("language", "en");
  url.searchParams.set("prioritydomain", "top");
  url.searchParams.set("removeduplicate", "1");
  url.searchParams.set("size", String(size));
  url.searchParams.set("category", newsDataTag);
  if (nextPageToken) url.searchParams.set("page", nextPageToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`NewsData API error ${res.status} for category "${newsDataTag}"`);
  }

  const json = await res.json();
  return {
    results: json.results ?? [],
    nextPage: json.nextPage ?? null,
  };
}

/**
 * Fetch `count` headlines for a given NewsData.io category tag.
 * Makes multiple requests (max 10 per call) as needed.
 * Returns an array of { title, description } objects.
 *
 * @param {string} newsDataTag  — e.g. "top", "technology", "sports"
 * @param {number} count        — total headlines to fetch (≥1)
 * @returns {Promise<Array<{ title: string, description: string }>>}
 */
export async function fetchHeadlines(newsDataTag, count) {
  const headlines = [];
  let nextPageToken = null;

  while (headlines.length < count) {
    const batchSize = Math.min(10, count - headlines.length);
    const { results, nextPage } = await fetchPage(newsDataTag, batchSize, nextPageToken);

    const valid = results
      .filter((a) => a.title && a.description)
      .map((a) => ({ title: a.title, description: a.description }));

    headlines.push(...valid);
    nextPageToken = nextPage;

    if (!nextPageToken) break;
  }

  if (headlines.length < count) {
    console.warn(
      `[newsdata] Only ${headlines.length}/${count} headlines available for category "${newsDataTag}"`
    );
  }

  return headlines.slice(0, count);
}
