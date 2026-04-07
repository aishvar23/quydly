const API_BASE = "https://newsdata.io/api/1/latest";

async function fetchPage(size, nextPageToken = null) {
  const url = new URL(API_BASE);
  url.searchParams.set("apikey", process.env.NEWSDATA_API_KEY);
  url.searchParams.set("language", "en");
  url.searchParams.set("prioritydomain", "top");
  url.searchParams.set("removeduplicate", "1");
  url.searchParams.set("size", String(size));
  url.searchParams.set("category", "top");
  if (nextPageToken) url.searchParams.set("page", nextPageToken);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NewsData API error ${res.status}`);
  const json = await res.json();
  return { results: json.results ?? [], nextPage: json.nextPage ?? null };
}

/**
 * Fetch up to `totalCount` articles using pagination.
 * Returns an array of { title, description, categories } objects,
 * where `categories` is the raw category array from the API response.
 */
export async function fetchAllHeadlines(totalCount = 100) {
  const articles = [];
  let nextPageToken = null;

  while (articles.length < totalCount) {
    const batchSize = Math.min(10, totalCount - articles.length);
    const { results, nextPage } = await fetchPage(batchSize, nextPageToken);

    const valid = results
      .filter((a) => a.title && a.description)
      .map((a) => ({
        title: a.title,
        description: a.description,
        // content is the full article text — available on paid NewsData plans, null on free
        content: a.content ?? null,
        link: a.link ?? null,
        categories: Array.isArray(a.category) ? a.category : [],
      }));

    articles.push(...valid);
    nextPageToken = nextPage;
    if (!nextPageToken) break;
  }

  if (articles.length < totalCount) {
    console.warn(`[newsdata] Only ${articles.length}/${totalCount} articles fetched`);
  }

  return articles.slice(0, totalCount);
}
