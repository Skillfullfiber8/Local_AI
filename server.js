import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3:8b";

// In-memory conversation storage
let conversation = `
You are a helpful, precise, and intelligent AI assistant.
Answer clearly and concisely.
`;

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    conversation += `\nUser: ${userMessage}\nAssistant:`;

    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: conversation,
        stream: false,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const aiReply = data.response.trim();

    conversation += ` ${aiReply}\n`;

    res.json({ reply: aiReply });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI server error" });
  }
});

// Reset conversation endpoint
app.post("/reset", (req, res) => {
  conversation = `
You are a helpful, precise, and intelligent AI assistant.
Answer clearly and concisely.
`;
  res.json({ status: "Conversation reset." });
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
});