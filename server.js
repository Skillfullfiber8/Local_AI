import express from "express";
import { createServer } from "https";
import http from "http";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

import { webSearch } from "./tools/searchTool.js";
import { transcribeAudio } from "./tools/voiceTool.js";
import { loadProfile, retrieveRelevantMemory, summarizeToMemory } from "./tools/memoryTool.js";
import {
  loadReminders,
  addReminder,
  listReminders,
  deleteReminder,
  startScheduler,
  flushPending
} from "./tools/reminderTool.js";

const { Client, LocalAuth } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WAKE_WORD    = process.env.WAKE_WORD || "jarvis";
const MODEL        = process.env.MODEL;
const OLLAMA_URL   = process.env.OLLAMA_URL;
const OWNER_PHONE  = (process.env.OWNER_PHONE || "").trim();
const WEBCHAT_CODE = (process.env.WEBCHAT_CODE || "").trim();
const OWNER_NAME   = process.env.OWNER_NAME || "Aniruddha";
const VIP_NUMBERS  = (process.env.VIP_NUMBERS || "").split(",").map(n => n.trim()).filter(Boolean);

/* ================= WhatsApp ================= */

const waClient = new Client({ authStrategy: new LocalAuth() });

waClient.on("qr", qr => qrcode.generate(qr, { small: true }));

waClient.on("ready", async () => {
  console.log("WhatsApp ready");
  loadReminders();
  startScheduler(waClient);
  await flushPending(waClient);
});

waClient.initialize();

/* ================= Ollama helper ================= */

async function ollamaFetch(prompt, temperature = 0) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, temperature })
  });
  const data = await response.json();
  return data?.response?.trim() || null;
}



async function askLLMRaw(prompt) {
  try {
    const raw = await ollamaFetch(prompt, 0.2);
    return raw?.trim() || null;
  } catch (err) {
    console.log("askLLMRaw error:", err);
    return null;
  }
}


/* ================= LLM ================= */

async function askLLM(prompt, userId = null) {
  const now = new Date();
  const profile = loadProfile();
  const relevantMemory = userId ? await retrieveRelevantMemory(prompt) : "";

  const systemPrompt = `
You are Jarvis, an AI assistant.
IMPORTANT FACTS (always use these, do not guess):
- Current date: ${now.toLocaleDateString()}
- Current time: ${now.toLocaleTimeString()}
${profile ? `\nAbout the user:\n${profile}` : ""}
${relevantMemory ? `\nRelevant memory from past conversations:\n${relevantMemory}` : ""}

STRICT RULES (never break these):
- Never use markdown, backticks, or code blocks
- Never say "Sir", "Sure", "Certainly" or any filler words
- For code, give the complete working code as plain text with no formatting, no matter how long
- For non-code responses, keep it under 5 lines
- Be direct and concise
`;

  const fullPrompt = systemPrompt + "\nUser: " + prompt + "\nAssistant:";

  try {
    const raw = await ollamaFetch(fullPrompt, 0.3);

    if (!raw) {
      console.log("Ollama returned no response");
      return "I couldn't process that right now.";
    }

    const reply = raw
      .replace(/```[\w]*\n?/g, "")
      .replace(/`/g, "")
      .replace(/^(Sir[,!]?\s*|Sure[,!]?\s*|Certainly[,!]?\s*)/i, "")
      .trim();

    if (userId) {
      summarizeToMemory(prompt, reply, ollamaFetch);
    }

    return reply;

  } catch (err) {
    console.log("askLLM error:", err);
    return "Something went wrong on my end.";
  }
}

/* ================= AI Reminder Extraction ================= */

async function extractReminderDetails(userText) {
  try {
    const raw = await ollamaFetch(`
You are a strict JSON reminder extractor.
Return ONLY valid JSON. No explanations. No markdown. No extra text.
Format:
{
  "task": "...",
  "datetime": "YYYY-MM-DDTHH:MM:SS"
}
Current datetime: ${new Date().toISOString()}
User input: ${userText}
`);
    return raw || null;
  } catch (err) {
    console.log("Reminder LLM fetch error:", err);
    return null;
  }
}

/* ================= Resolve WhatsApp ID ================= */

async function resolveId(msg) {
  try {
    const contact = await msg.getContact();
    return contact.id._serialized;
  } catch {
    return msg.from;
  }
}

/* ================= Process Message (shared by all platforms) ================= */

import { runAgent } from "./tools/agent.js";

async function processMessage(text, resolvedUserId) {
  return await runAgent(text, resolvedUserId);
}

/* ================= WhatsApp Message Handler ================= */

waClient.on("message_create", async msg => {
  console.log("RAW MSG:", msg.fromMe, msg.type, msg.body);

  let text = msg.body.trim();

  if (msg.hasMedia && (msg.type === "ptt" || msg.type === "audio")) {
    const media = await msg.downloadMedia();
    console.log("Voice note received, transcribing...");
    const transcript = await transcribeAudio(media.data, media.mimetype);
    if (!transcript) {
      await msg.reply("Jarvis: Could not transcribe audio.");
      return;
    }
    console.log("Transcript:", transcript);
    text = transcript;
  }

  if (!text) return;

  const wakeRegex = new RegExp(`\\b${WAKE_WORD}\\b`, "i");
  if (!wakeRegex.test(text)) return;
  if (msg.fromMe && text.startsWith("Jarvis:")) return;

  const userId = await resolveId(msg);
  const resolvedUserId = userId;
  console.log("Wake word triggered from:", resolvedUserId, "→", text);

  const cleanMessage = text.replace(wakeRegex, "").trim();

  if (/list reminders/i.test(cleanMessage)) {
    const userReminders = listReminders(resolvedUserId);
    if (!userReminders.length) { await msg.reply("Jarvis: No active reminders."); return; }
    const list = userReminders.map(r => `${r.id} - ${r.task} at ${new Date(r.time).toLocaleString()}`).join("\n");
    await msg.reply("Jarvis:\n" + list);
    return;
  }

  if (/delete reminder/i.test(cleanMessage)) {
    const idMatch = cleanMessage.match(/\d+/);
    if (!idMatch) { await msg.reply("Jarvis: Provide reminder ID."); return; }
    deleteReminder(parseInt(idMatch[0]));
    await msg.reply("Jarvis: Reminder deleted.");
    return;
  }

  if (/remind me/i.test(cleanMessage)) {
  try {
    const parsedRaw = await extractReminderDetails(cleanMessage);
    if (!parsedRaw) {
      await msg.reply("Jarvis: I couldn't understand the reminder.");
      return;
    }

    let cleanRaw = parsedRaw.trim();
    if (!cleanRaw.endsWith("}")) cleanRaw += "}";
    const jsonMatch = cleanRaw.match(/\{[^{}]*\}/);
    if (!jsonMatch) {
      await msg.reply("Jarvis: Reminder format error.");
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.task || !parsed.datetime) {
      await msg.reply("Jarvis: Reminder details incomplete.");
      return;
    }

    const reminderTime = new Date(parsed.datetime);
    if (isNaN(reminderTime.getTime())) {
      await msg.reply("Jarvis: Invalid time format.");
      return;
    }

    if (reminderTime <= new Date()) {
      await msg.reply("Jarvis: That time has already passed.");
      return;
    }

    addReminder(resolvedUserId, parsed.task, reminderTime);
    await msg.reply(`Jarvis: Reminder set for "${parsed.task}" at ${reminderTime.toLocaleString()}`);

  } catch (err) {
    console.log("Reminder parsing error:", err);
    await msg.reply("Jarvis: I couldn't process that reminder.");
  }
  return;
}

  const reply = await processMessage(cleanMessage, resolvedUserId);
  await msg.reply("Jarvis: " + reply);
});

/* ================= Express setup ================= */

const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(express.static(path.join(__dirname, "webchat", "dist")));
app.get("/", (req, res) => res.send("Jarvis Running"));

/* ================= HTTPS WebSocket (port 5000) — WebChat & mobile ================= */

const sslOptions = {
  key: fs.readFileSync("./localhost+1-key.pem"),
  cert: fs.readFileSync("./localhost+1.pem")
};
const httpsServer = createServer(sslOptions, app);
const wss = new WebSocketServer({ server: httpsServer });

wss.on("connection", (ws) => {
  console.log("WebChat connected");
  ws.authenticated = false;

  ws.on("message", async (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);

      if (type === "auth_check") {
        const { platformId } = payload;
        if (!WEBCHAT_CODE) {
          ws.authenticated = true;
          ws.userId = OWNER_PHONE ? OWNER_PHONE + "@c.us" : platformId;
          ws.send(JSON.stringify({ type: "auth_success", name: OWNER_NAME }));
        } else {
          ws.send(JSON.stringify({ type: "need_auth" }));
        }
        return;
      }

      if (type === "auth_phone") {
        const { phone } = payload;
        if (OWNER_PHONE && phone.trim() === OWNER_PHONE) {
          ws.pendingPhone = phone.trim();
          ws.send(JSON.stringify({ type: "need_code" }));
        } else {
          ws.send(JSON.stringify({ type: "auth_fail" }));
        }
        return;
      }

      if (type === "auth") {
        const { platformId, phone, code } = payload;
        if (code.trim() === WEBCHAT_CODE && phone.trim() === OWNER_PHONE) {
          ws.authenticated = true;
          ws.userId = OWNER_PHONE + "@c.us";
          ws.send(JSON.stringify({ type: "auth_success", name: OWNER_NAME }));
        } else {
          ws.send(JSON.stringify({ type: "auth_fail" }));
        }
        return;
      }

      if (!ws.authenticated) {
        ws.send(JSON.stringify({ type: "need_auth" }));
        return;
      }

      const resolvedUserId = ws.userId || payload?.platformId;

      if (type === "message") {
        const { text } = payload;
        console.log("WebChat message from:", resolvedUserId, "→", text);
        const reply = await processMessage(text, resolvedUserId);
        ws.send(JSON.stringify({ type: "reply", text: reply }));
        return;
      }

      if (type === "voice") {
        const { audio, mimetype } = payload;
        const transcript = await transcribeAudio(audio, mimetype);
        if (!transcript) {
          ws.send(JSON.stringify({ type: "error", text: "Could not transcribe audio." }));
          return;
        }
        console.log("WebChat voice transcript:", transcript);
        ws.send(JSON.stringify({ type: "transcript", text: transcript }));
        const reply = await processMessage(transcript, resolvedUserId);
        ws.send(JSON.stringify({ type: "reply", text: reply }));
        return;
      }

    } catch (err) {
      console.log("WebSocket error:", err.message);
      ws.send(JSON.stringify({ type: "error", text: "Something went wrong." }));
    }
  });

  ws.on("close", () => console.log("WebChat disconnected"));
});

httpsServer.listen(process.env.PORT || 5000, () =>
  console.log(`Server running on ${process.env.PORT || 5000}`)
);

/* ================= Plain HTTP WebSocket (port 5001) — Desktop voice only ================= */

const httpServer = http.createServer();
const wssDesktop = new WebSocketServer({ server: httpServer });

wssDesktop.on("connection", (ws) => {
  console.log("Desktop voice connected");
  ws.userId = OWNER_PHONE ? OWNER_PHONE + "@c.us" : "desktop-voice";

  ws.on("message", async (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);
      if (type === "message") {
        const reply = await processMessage(payload.text, ws.userId);
        ws.send(JSON.stringify({ type: "reply", text: reply }));
      }
    } catch (err) {
      console.log("Desktop WS error:", err.message);
    }
  });

  ws.on("close", () => console.log("Desktop voice disconnected"));
});

httpServer.listen(5001, () => console.log("Desktop voice server on 5001"));

export { askLLM, askLLMRaw };