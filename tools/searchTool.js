import fetch from "node-fetch";

const SEARXNG_URL = "http://localhost:8080";

export async function webSearch(query) {
  console.log("🌐 Searching:", query);

  try {
    const res = await fetch(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const data = await res.json();

    if (!data.results || !data.results.length) {
      return "No results found.";
    }

    // Top 3 results as clean text
    return data.results.slice(0, 3).map(r =>
      `Title: ${r.title}\nSummary: ${r.content}`
    ).join("\n\n");

  } catch (err) {
    console.log("Search error:", err.message);
    return "Web search failed.";
  }
}