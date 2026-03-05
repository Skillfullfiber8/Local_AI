import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import fetch from "node-fetch";

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

const WAKE_WORD = "jarvis";
const MODEL = "llama3:8b";
const OLLAMA_URL = "http://127.0.0.1:11434";

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

async function askLLM(prompt) {
  const now = new Date();

  const systemPrompt = `
You are Jarvis.
IMPORTANT FACTS (always use these, do not guess):
- Current date: ${now.toLocaleDateString()}
- Current time: ${now.toLocaleTimeString()}
Respond in maximum 3 short lines.
No markdown.
Be concise.
`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: systemPrompt + "\nUser: " + prompt + "\nAssistant:",
        stream: false,
        temperature: 0.3
      })
    });

    const data = await response.json();



    if (!data || !data.response) {
      console.log("Ollama returned no response field:", data);
      return "I couldn't process that right now.";
    }

    return data.response.trim().split("\n").slice(0, 3).join("\n");

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
- "search"   : user wants to search the web, look something up, or get current info
- "general"  : anything else (chat, questions the AI can answer itself)

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

/* ================= Message Handler ================= */

waClient.on("message_create", async msg => {

  if (msg.fromMe && msg.body.startsWith("Jarvis:")) return;

  let text = msg.body.trim();
  const wakeRegex = new RegExp(`\\b${WAKE_WORD}\\b`, "i");

  if (!wakeRegex.test(text)) return;

  console.log("wake word triggered:", text);

  let cleanMessage = text.replace(wakeRegex, "").trim();

  /* ===== Classify Intent ===== */

  const { intent, query } = await classifyIntent(cleanMessage);

  /* ===== Reminder Intent ===== */

  if (intent === "reminder") {

    // Handle list and delete via regex since they need no LLM extraction
    if (/list reminders/i.test(cleanMessage)) {
      const userReminders = listReminders(msg.from);
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
        // Extract only the first complete JSON object, ignoring hallucinated content after it
        // Auto-close truncated JSON if model cuts off before closing brace
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
      addReminder(msg.from, parsed.task, reminderTime);

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
    const summary = await askLLM(`Summarize these search results in 3 lines:\n${results}`);
    await msg.reply("Jarvis: " + summary);
    return;
  }

  /* ===== General AI ===== */

  const reply = await askLLM(cleanMessage);
  await msg.reply("Jarvis: " + reply);

});

/* ================= Express ================= */

const app = express();
app.get("/", (req, res) => res.send("Jarvis Running"));

app.listen(5000, () => console.log("Server running on 5000"));