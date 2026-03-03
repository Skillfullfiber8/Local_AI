export async function webSearch(query) {
    console.log("Performing web search for:", query);
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    );

    const data = await res.json();
    console.log("Web search data:", data);

    if (data.AbstractText) return data.AbstractText;

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      return data.RelatedTopics[0].Text || "No clear result found.";
    }

    return "No useful results found.";

  } catch (err) {
    console.error("Web search error:", err);
    return "Web search failed.";
  }
}