import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { searchVectors } from "./vectorStore.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL = "llama3:8b";
const EMBED_MODEL = "nomic-embed-text";

/* ==============================
   TEXT CHAT (STREAMING + RAG)
================================ */
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

    const finalPrompt = `
Answer strictly using the context below.
If the answer is not in the context, say "I don't know."

Context:
${context}

Question:
${userQuery}

Answer:
`;

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

/* ==============================
   OFFLINE VOICE INPUT
   WebM → WAV → Whisper
================================ */
app.post("/voice-input", (req, res) => {
  const webmFile = path.join(process.cwd(), "input.webm");
  const wavFile = path.join(process.cwd(), "input.wav");

  const writeStream = fs.createWriteStream(webmFile);
  req.pipe(writeStream);

  writeStream.on("finish", () => {

    // Convert WebM → WAV (16kHz mono)
    exec(
      `"${process.cwd()}\\voice\\ffmpeg\\ffmpeg.exe" -y -i "${webmFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavFile}"`,
      (ffErr) => {
        if (ffErr) {
          console.error("FFmpeg error:", ffErr);
          return res.status(500).send("Audio conversion failed");
        }

        // Run Whisper
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

/* ==============================
   OFFLINE VOICE OUTPUT (Piper)
================================ */
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
      console.error("Piper exited with code:", code);
      return res.status(500).send("TTS failed");
    }

    if (!fs.existsSync(outputFile)) {
      return res.status(500).send("Audio not generated");
    }

    res.sendFile(outputFile);
  });
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Full Offline Voice AI running on port 5000");
});