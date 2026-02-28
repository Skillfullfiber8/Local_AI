import fs from "fs";
import fetch from "node-fetch";
import { saveVectors } from "./vectorStore.js";

const OLLAMA_URL = "http://127.0.0.1:11434";
const EMBED_MODEL = "nomic-embed-text";

async function embed(text) {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      prompt: text
    })
  });

  const data = await response.json();
  return data.embedding;
}

async function ingest() {
  const content = fs.readFileSync("mydoc.txt", "utf8");
  const chunks = content.match(/.{1,500}/gs);

  const vectors = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);

    vectors.push({
      text: chunks[i],
      embedding
    });

    console.log(`Indexed chunk ${i}`);
  }

  saveVectors(vectors);
  console.log("Ingestion complete.");
}

ingest();