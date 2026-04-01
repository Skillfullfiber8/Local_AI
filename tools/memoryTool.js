import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const EMBED_MODEL = "nomic-embed-text";

function getVault() { return process.env.OBSIDIAN_VAULT; }
function getMemoryDir() { return path.join(getVault(), "memory"); }
function getProfilePath() { return path.join(getVault(), "profile.md"); }
function getOllamaUrl() { return process.env.OLLAMA_URL || "http://127.0.0.1:11434"; }
function getLookbackDays() { return parseInt(process.env.MEMORY_LOOKBACK_DAYS || "7"); }
function getMaxEntries() { return parseInt(process.env.MEMORY_MAX_LINES || "10"); }

function ensureMemoryDir() {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ================= Profile ================= */

export function loadProfile() {
  try {
    const profilePath = getProfilePath();
    if (!fs.existsSync(profilePath)) return "";
    return fs.readFileSync(profilePath, "utf8").trim();
  } catch {
    return "";
  }
}

/* ================= Daily memory file path ================= */

function memoryFilePath(date = new Date()) {
  const dateStr = date.toISOString().split("T")[0];
  return path.join(getMemoryDir(), `${dateStr}.md`);
}

/* ================= Save structured memory entry ================= */

export function saveMemoryEntry({ topic, userIdea, keyTakeaway }) {
  ensureMemoryDir();
  const filePath = memoryFilePath();
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toISOString().split("T")[0];

  const entry = `
### ${dateStr} ${timeStr}

Topic: ${topic}

User idea:
${userIdea}

Key takeaway:
${keyTakeaway}

---
`;

  fs.appendFileSync(filePath, entry, "utf8");
}

/* ================= Parse memory entries from files ================= */

function parseEntries(fileContent) {
  const blocks = fileContent.split("---").map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const topicMatch = block.match(/^Topic:\s*(.+)$/m);
    const ideaMatch = block.match(/User idea:\s*([\s\S]*?)(?=\nKey takeaway:)/);
    const takeawayMatch = block.match(/Key takeaway:\s*([\s\S]*?)$/);
    const dateMatch = block.match(/###\s*(\d{4}-\d{2}-\d{2}\s[\d:]+)/);

    return {
      raw: block,
      topic: topicMatch?.[1]?.trim() || "",
      userIdea: ideaMatch?.[1]?.trim() || "",
      keyTakeaway: takeawayMatch?.[1]?.trim() || "",
      date: dateMatch?.[1]?.trim() || "",
      searchText: `${topicMatch?.[1] || ""} ${takeawayMatch?.[1] || ""}`.trim()
    };
  }).filter(e => e.topic);
}

/* ================= Load entries from last N days ================= */

function loadRecentEntries() {
  const entries = [];
  const lookback = getLookbackDays();
  for (let i = 0; i < lookback; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const filePath = memoryFilePath(date);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    entries.push(...parseEntries(content));
  }
  return entries;
}

/* ================= Embedding via Ollama ================= */

async function getEmbedding(text) {
  try {
    const response = await fetch(`${getOllamaUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
    });
    const data = await response.json();
    return data.embedding || null;
  } catch {
    return null;
  }
}

/* ================= Cosine similarity ================= */

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/* ================= Retrieve relevant memory ================= */

export async function retrieveRelevantMemory(currentMessage) {
  const entries = loadRecentEntries();
  if (!entries.length) return "";

  const messageEmbedding = await getEmbedding(currentMessage);
  if (!messageEmbedding) {
    // Fallback: return most recent entries if embedding fails
    return entries.slice(0, MAX_ENTRIES).map(e => e.raw).join("\n---\n");
  }

  // Embed all entries and score them
  const scored = await Promise.all(entries.map(async entry => {
    const embedding = await getEmbedding(entry.searchText);
    const score = cosineSimilarity(messageEmbedding, embedding);
    return { entry, score };
  }));

  // Sort by relevance, take top N
  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, getMaxEntries())
    .filter(s => s.score > 0.3); // ignore very low relevance

  if (!top.length) return "";

  return top.map(s => s.entry.raw).join("\n---\n");
}

/* ================= Summarize exchange into structured entry ================= */

export async function summarizeToMemory(userMessage, assistantReply, ollama_fetch) {
  // Skip saving trivial exchanges
  const TRIVIAL = /^(hi|hello|hey|ok|okay|thanks|thank you|bye|good|great|sure|yes|no|👋|😊|🙏)+[!?.]*$/i;
  if (userMessage.length < 15 || TRIVIAL.test(userMessage.trim())) return;

  try {
    const response = await ollama_fetch(`
You are a personal memory extractor for an AI assistant called Jarvis.
Your job is to extract ONLY meaningful, personal, or actionable information from a conversation.

ONLY save if the exchange contains:
- Facts about the user (preferences, plans, goals, opinions, personal details)
- Decisions made or actions planned
- Technical details about the user's projects
- Important context about what the user is working on

Do NOT save if the exchange is:
- Generic greetings or small talk
- Simple factual questions with no personal relevance
- Search result summaries

If there is nothing worth saving, return: { "skip": true }

Otherwise return ONLY valid JSON, no markdown, no explanation:
{
  "topic": "concise topic (e.g. 'Jarvis project - notes tool plan')",
  "userIdea": "what the user specifically said, wants, or believes",
  "keyTakeaway": "the concrete insight, decision, or fact to remember about this user"
}

User: ${userMessage}
Assistant: ${assistantReply}
`);

    if (!response) return;

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.skip) return;
    if (parsed.topic && parsed.userIdea && parsed.keyTakeaway) {
      saveMemoryEntry(parsed);
      console.log("Memory saved:", parsed.topic);
    }
  } catch (err) {
    console.log("Memory summarize error:", err.message);
  }
}