import fs from "fs";

const DB_FILE = "vectors.json";

export function saveVectors(vectors) {
  fs.writeFileSync(DB_FILE, JSON.stringify(vectors, null, 2));
}

export function loadVectors() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

export function searchVectors(queryEmbedding, topK = 3) {
  const vectors = loadVectors();

  const scored = vectors.map(item => ({
    text: item.text,
    score: cosineSimilarity(queryEmbedding, item.embedding)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.text);
}