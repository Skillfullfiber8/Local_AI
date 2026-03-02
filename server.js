import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { exec, spawn } from "child_process";
import https from "https";
import fs from "fs";
import path from "path";
import { searchVectors } from "./vectorStore.js";

/* ===============================
   WHATSAPP SETUP
================================= */
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";

const { Client, LocalAuth } = pkg;

const waClient = new Client({
  authStrategy: new LocalAuth()
});

waClient.on("qr", (qr) => {
  console.log("Scan this QR with WhatsApp:");
  qrcode.generate(qr, { small: true });
});

waClient.on("ready", () => {
  console.log("WhatsApp Client is ready!");
});

waClient.initialize();

/* ===============================
   WHATSAPP AI CHAT (Wake Word Based)
================================= */

const WAKE_WORD = "jarvis"; // change this anytime

waClient.on("message", async (msg) => {
  try {

    // Ignore group messages (optional)
    if (msg.from.includes("@g.us")) return;

    const text = msg.body.trim();

    // Check wake word
    if (!text.toLowerCase().startsWith(WAKE_WORD.toLowerCase())) {
      return; // Ignore if wake word not used
    }

    console.log("Wake word detected via WhatsApp");

    // Remove wake word
    const userQuery = text.slice(WAKE_WORD.length).trim();

    if (!userQuery) {
      await msg.reply("Yes? What do you need?");
      return;
    }

    // Send to Ollama
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: userQuery,
        stream: false,
        temperature: 0.3
      })
    });

    const data = await ollamaRes.json();

    const reply = data.response || "I could not generate a response.";

    await msg.reply(reply);

  } catch (err) {
    console.error("WhatsApp AI error:", err);
    await msg.reply("Something went wrong.");
  }
});

/* ===============================
   EXPRESS APP
================================= */

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL = "llama3:8b";
const EMBED_MODEL = "nomic-embed-text";

/* ===============================
   ROBUST WAKE SYSTEM
================================= */

let lastWakeTime = 0;
const WAKE_WINDOW_MS = 2000;

app.post("/wake", (req, res) => {
  lastWakeTime = Date.now();
  console.log("Wake word triggered");
  res.sendStatus(200);
});

app.get("/wake-status", (req, res) => {
  const wakeActive = (Date.now() - lastWakeTime) < WAKE_WINDOW_MS;
  res.setHeader("Cache-Control", "no-store");
  res.json({ wake: wakeActive });
});

/* ===============================
   WHATSAPP SEND ENDPOINT
================================= */

app.post("/send-whatsapp", async (req, res) => {
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ error: "Missing number or message" });
  }

  try {
    const chatId = number.includes("@c.us")
      ? number
      : `${number}@c.us`;

    await waClient.sendMessage(chatId, message);

    res.json({ success: true });
  } catch (err) {
    console.error("WhatsApp error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* ===============================
   STREAMING CHAT + HYBRID RAG
================================= */

app.post("/chat", async (req, res) => {
  try {
    const userQuery = req.body.message;

    const embedRes = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: userQuery
      })
    });

    const embedData = await embedRes.json();
    const queryEmbedding = embedData.embedding;

    const contextChunks = searchVectors(queryEmbedding, 3);
    const context = contextChunks.join("\n");

    let finalPrompt;

    if (contextChunks.length > 0 && context.trim().length > 50) {
      finalPrompt = `
You are an intelligent assistant.

Use the provided context if relevant.
If insufficient, use general knowledge.

Context:
${context}

Question:
${userQuery}

Answer:
`;
    } else {
      finalPrompt = userQuery;
    }

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
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
    res.status(500).end("Chat failed");
  }
});

/* ===============================
   VOICE INPUT (WebM → WAV → Whisper)
================================= */

app.post("/voice-input", (req, res) => {
  const webmFile = path.join(process.cwd(), "input.webm");
  const wavFile = path.join(process.cwd(), "input.wav");

  const writeStream = fs.createWriteStream(webmFile);
  req.pipe(writeStream);

  writeStream.on("finish", () => {

    exec(
      `"${process.cwd()}\\voice\\ffmpeg\\ffmpeg.exe" -y -i "${webmFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavFile}"`,
      (ffErr) => {
        if (ffErr) {
          console.error("FFmpeg error:", ffErr);
          return res.status(500).send("Audio conversion failed");
        }

        exec(
          `"${process.cwd()}\\voice\\whisper\\whisper-cli.exe" -m "${process.cwd()}\\voice\\whisper\\models\\ggml-tiny.en.bin" -f "${wavFile}"`,
          (error, stdout) => {
            if (error) {
              console.error("Whisper error:", error);
              return res.status(500).send("Whisper failed");
            }

            const cleaned = stdout
              .replace(/\[.*?\]/g, "")
              .replace(/\n/g, " ")
              .trim();

            res.json({ text: cleaned });
          }
        );
      }
    );
  });
});

/* ===============================
   VOICE OUTPUT (Piper)
================================= */

app.post("/voice-output", (req, res) => {
  const text = req.body.text;
  const outputFile = path.join(process.cwd(), "response.wav");

  const piperPath = path.join(process.cwd(), "voice", "piper", "piper.exe");
  const modelPath = path.join(process.cwd(), "voice", "piper", "models", "en_US-lessac-medium.onnx");

  const piper = spawn(piperPath, [
    "--model", modelPath,
    "--output_file", outputFile
  ]);

  piper.stdin.write(text);
  piper.stdin.end();

  piper.on("close", (code) => {
    if (code !== 0) {
      console.error("Piper failed");
      return res.status(500).send("TTS failed");
    }

    if (!fs.existsSync(outputFile)) {
      return res.status(500).send("Audio not generated");
    }

    res.sendFile(outputFile);
  });
});

/* ===============================
   HTTPS SERVER
================================= */

const options = {
  key: fs.readFileSync("./localhost+1-key.pem"),
  cert: fs.readFileSync("./localhost+1.pem")
};

https.createServer(options, app).listen(5000, "0.0.0.0", () => {
  console.log("HTTPS Server running on port 5000");
});