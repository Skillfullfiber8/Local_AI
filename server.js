import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";

import {
  loadReminders,
  parseTime,
  addReminder,
  listReminders,
  deleteReminder,
  startScheduler,
  flushPending
} from "./tools/reminderTool.js";

import { webSearch } from "./tools/webSearchTool.js";

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

  const systemPrompt = `
You are Jarvis.

If question needs recent info, respond ONLY in JSON:
{ "tool": "webSearch", "query": "..." }

Otherwise reply in max 3 short lines.
No markdown.
`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: systemPrompt + "\nUser: " + prompt + "\nAssistant:",
      stream: false
    })
  });

  const data = await response.json();
  let reply = data.response.trim();

  try {
    const parsed = JSON.parse(reply);

    if (parsed.tool === "webSearch") {
      const result = await webSearch(parsed.query);

      const summary = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: "Summarize in 2 short lines:\n" + result,
          stream: false
        })
      });

      const summaryData = await summary.json();
      return summaryData.response.trim();
    }

  } catch {}

  return reply.split("\n").slice(0, 3).join("\n");
}

/* ================= Message Handler ================= */

waClient.on("message_create", async msg => {

  if (msg.fromMe && msg.body.startsWith("Jarvis:")) return;

  let text = msg.body.trim();
  const wakeRegex = new RegExp(`\\b${WAKE_WORD}\\b`, "i");

  if (!wakeRegex.test(text)) return;

  let cleanMessage = text.replace(wakeRegex, "").trim();

  // Fix common typo
  cleanMessage = cleanMessage.replace(/remainder/i, "reminder");

  /* ===== Reminder Intent ===== */
  if (/remind|reminder|set.*remind/i.test(cleanMessage)) {

    const time = parseTime(cleanMessage);
    if (!time) {
      await msg.reply("Jarvis: I couldn't understand the time.");
      return;
    }

    if (time <= new Date()) {
      await msg.reply("Jarvis: That time has already passed.");
      return;
    }

    const taskMatch = cleanMessage.match(
      /(?:remind me to|set (?:a )?reminder (?:to)?)(.*?)(?:at|in|on|today|tomorrow|next)/i
    );

    const task = taskMatch ? taskMatch[1].trim() : "Task";

    addReminder(msg.from, task, time);

    await msg.reply(
      `Jarvis: Reminder set for ${time.toLocaleString()}`
    );

    return;
  }

  /* ===== List Reminders ===== */
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

  /* ===== Delete Reminder ===== */
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

  /* ===== Normal AI ===== */
  const reply = await askLLM(cleanMessage);
  await msg.reply("Jarvis: " + reply);
});

/* ================= Express ================= */

const app = express();
app.get("/", (req, res) => res.send("Jarvis Running"));

app.listen(5000, () => console.log("Server running on 5000"));