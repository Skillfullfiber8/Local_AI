import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { searchVectors } from "./vectorStore.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL = "llama3:8b";
const EMBED_MODEL = "nomic-embed-text";



app.post("/chat", async (req, res) => {
  try {
    const userQuery = req.body.message;

    // Embed query
    const embedRes = await fetch("http://127.0.0.1:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: userQuery
      })
    });

    const embedData = await embedRes.json();
    const queryEmbedding = embedData.embedding;

    const contextChunks = searchVectors(queryEmbedding, 3);
    const context = contextChunks.join("\n");

    const finalPrompt = `
Answer strictly using the context below.
If the answer is not in the context, say "I don't know."

Context:
${context}

Question:
${userQuery}

Answer:
`;

    // Tell browser we're streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const ollamaRes = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3:8b",
        prompt: finalPrompt,
        stream: true,
        temperature: 0.3
      })
    });

    for await (const chunk of ollamaRes.body) {
      const lines = chunk.toString().split("\n").filter(Boolean);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (parsed.response) {
          res.write(parsed.response);
        }
      }
    }

    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).end("Streaming failed");
  }
});

app.listen(5000, "0.0.0.0", () => {
  console.log("RAG Server running on port 5000");
});