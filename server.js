import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import { webSearch } from "./tools/searchTool.js";

import {
  loadReminders,
  addReminder,
  listReminders,
  deleteReminder,
  startScheduler,
  flushPending
} from "./tools/reminderTool.js";

const { Client, LocalAuth } = pkg;

const MODEL = process.env.MODEL;
const OLLAMA_URL = process.env.OLLAMA_URL;
const MAX_HISTORY = 10;
const VIP_NUMBERS = process.env.VIP_NUMBERS.split(",").map(n => n.trim());

/* ================= Memory ================= */

const userMemory = new Map();
const MEMORY_DIR = "./memory";

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);

function memoryPath(userId) {
  return `${MEMORY_DIR}/${userId.replace(/[^a-z0-9]/gi, "_")}.json`;
}

function loadDiskMemory(userId) {
  try {
    const data = fs.readFileSync(memoryPath(userId), "utf8");
    userMemory.set(userId, JSON.parse(data));
  } catch {
    userMemory.set(userId, []);
  }
}

function saveDiskMemory(userId) {
  const path = memoryPath(userId);
  fs.writeFileSync(path, JSON.stringify(userMemory.get(userId)));
  console.log("Memory saved:", path);
}

function getHistory(userId) {
  if (!userMemory.has(userId)) {
    if (VIP_NUMBERS.includes(userId)) loadDiskMemory(userId);
    else userMemory.set(userId, []);
  }
  return userMemory.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  if (VIP_NUMBERS.includes(userId)) saveDiskMemory(userId);
}

/* ================= WhatsApp ================= */

const waClient = new Client({
  authStrategy: new LocalAuth()
});

waClient.on("qr", qr => {
  qrcode.generate(qr, { small: true });
});

waClient.on("ready", async () => {
  console.log("WhatsApp ready");
  loadReminders();
  startScheduler(waClient);
  await flushPending(waClient);
});

waClient.initialize();

/* ================= LLM ================= */

async function askLLM(prompt, userId = null) {
  const now = new Date();

  const systemPrompt = `
You are Jarvis, an AI assistant.
IMPORTANT FACTS (always use these, do not guess):
- Current date: ${now.toLocaleDateString()}
- Current time: ${now.toLocaleTimeString()}

STRICT RULES (never break these):
- Never use markdown, backticks, or code blocks
- Never say "Sir", "Sure", "Certainly" or any filler words
- For code, give the complete working code as plain text with no formatting, no matter how long
- For non-code responses, keep it under 5 lines
- Be direct and concise
`;

  const history = userId ? getHistory(userId) : [];
  const historyText = history.map(m =>
    `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
  ).join("\n");

  const fullPrompt = systemPrompt
    + (historyText ? "\n" + historyText + "\n" : "")
    + "\nUser: " + prompt + "\nAssistant:";

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: fullPrompt,
        stream: false,
        temperature: 0.3
      })
    });

    const data = await response.json();

    if (!data || !data.response) {
      console.log("Ollama returned no response field:", data);
      return "I couldn't process that right now.";
    }

    const raw = data.response.trim()
      .replace(/```[\w]*\n?/g, "")
      .replace(/`/g, "")
      .replace(/^(Sir[,!]?\s*|Sure[,!]?\s*|Certainly[,!]?\s*)/i, "")
      .trim();

    const reply = raw;
    if (userId) {
      addToHistory(userId, "user", prompt);
      addToHistory(userId, "assistant", reply);
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
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: `
You are a strict JSON reminder extractor.

Return ONLY valid JSON.
No explanations.
No markdown.
No extra text.

Format:
{
  "task": "...",
  "datetime": "YYYY-MM-DDTHH:MM:SS"
}

Current datetime: ${new Date().toISOString()}

User input:
${userText}
`,
        stream: false,
        temperature: 0
      })
    });

    const data = await response.json();

    if (!data || !data.response) {
      console.log("Invalid LLM response structure");
      return null;
    }

    const raw = data.response.trim();
    if (!raw) {
      console.log("Empty LLM response");
      return null;
    }

    return raw;

  } catch (err) {
    console.log("Reminder LLM fetch error:", err);
    return null;
  }
}

/* ================= Intent Classifier ================= */

async function classifyIntent(message) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: `
You are an intent classifier for an AI assistant.

Classify the user message into one of these intents:
- "reminder" : user wants to set, list, or delete a reminder
- "search"   : user wants to search the web, look something up, or get current info that the AI cannot answer from memory or its own knowledge
- "general"  : anything else (chat, questions the AI can answer itself or from conversation history)

Return ONLY valid JSON. No explanation. No markdown.

Format:
{ "intent": "reminder" | "search" | "general", "query": "<cleaned up user query>" }

User message: ${message}
`,
        stream: false,
        temperature: 0
      })
    });

    const data = await response.json();
    if (!data || !data.response) return { intent: "general", query: message };

    let raw = data.response.trim();
    if (!raw.endsWith("}")) raw += "}";

    const jsonMatch = raw.match(/\{[^{}]*\}/);
    if (!jsonMatch) return { intent: "general", query: message };

    const parsed = JSON.parse(jsonMatch[0]);
    console.log("Intent:", parsed);
    return parsed;

  } catch (err) {
    console.log("Intent classifier error:", err.message);
    return { intent: "general", query: message };
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

/* ================= Message Handler ================= */

waClient.on("message_create", async msg => {

  if (msg.fromMe) return;

  const text = msg.body.trim();
  if (!text) return;

  const userId = await resolveId(msg);
  console.log("Message from:", userId, "→", text);

  const cleanMessage = text;

  const { intent, query } = await classifyIntent(cleanMessage);

  /* ===== Reminder Intent ===== */

  if (intent === "reminder") {

    if (/list reminders/i.test(cleanMessage)) {
      const userReminders = listReminders(userId);
      if (!userReminders.length) {
        await msg.reply("Jarvis: No active reminders.");
        return;
      }
      const list = userReminders.map(r =>
        `${r.id} - ${r.task} at ${new Date(r.time).toLocaleString()}`
      ).join("\n");
      await msg.reply("Jarvis:\n" + list);
      return;
    }

    if (/delete reminder/i.test(cleanMessage)) {
      const idMatch = cleanMessage.match(/\d+/);
      if (!idMatch) {
        await msg.reply("Jarvis: Provide reminder ID.");
        return;
      }
      deleteReminder(parseInt(idMatch[0]));
      await msg.reply("Jarvis: Reminder deleted.");
      return;
    }

    try {
      const parsedRaw = await extractReminderDetails(cleanMessage);

      if (!parsedRaw) {
        console.log("Reminder LLM returned null/empty");
        await msg.reply("Jarvis: I couldn't understand the reminder.");
        return;
      }

      let parsed;

      try {
        let cleanRaw = parsedRaw.trim();
        if (!cleanRaw.endsWith("}")) cleanRaw += "}";
        const jsonMatch = cleanRaw.match(/\{[^{}]*\}/);
        if (!jsonMatch) {
          console.log("No JSON object found in LLM response:", parsedRaw);
          await msg.reply("Jarvis: Reminder format error.");
          return;
        }
        parsed = JSON.parse(jsonMatch[0]);
      } catch (jsonErr) {
        console.log("Invalid JSON from LLM:", parsedRaw);
        await msg.reply("Jarvis: Reminder format error.");
        return;
      }

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

      console.log(`Reminder set → task: "${parsed.task}" | time: ${reminderTime.toLocaleString()}`);
      addReminder(userId, parsed.task, reminderTime);

      await msg.reply(
        `Jarvis: Reminder set for "${parsed.task}" at ${reminderTime.toLocaleString()}`
      );

    } catch (err) {
      console.log("Reminder parsing error:", err);
      await msg.reply("Jarvis: I couldn't process that reminder.");
    }

    return;
  }

  /* ===== Search Intent ===== */

  if (intent === "search") {
    const results = await webSearch(query || cleanMessage);
    const summary = await askLLM(`Summarize these search results in 3 lines:\n${results}`, userId);
    await msg.reply("Jarvis: " + summary);
    return;
  }

  /* ===== General AI ===== */

  const reply = await askLLM(cleanMessage, userId);
  await msg.reply("Jarvis: " + reply);

});

/* ================= Express ================= */

const app = express();
app.get("/", (req, res) => res.send("Jarvis Running"));

app.listen(process.env.PORT || 5000, () => console.log(`Server running on ${process.env.PORT || 5000}`));