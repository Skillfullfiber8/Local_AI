import { webSearch } from "./searchTool.js";
import { actionTool } from "./actionTool.js";
import { askLLM, askLLMRaw } from "../server.js";

const TOOLS = {
  search: async (input) => await webSearch(input),

  open_app: async (input) => await actionTool("open_app", input),

  open_url: async (input) => await actionTool("open_url", input),

  google_search: async (input) => await actionTool("google_search", input)
};

export async function runAgent(userInput, userId) {

  let steps = 0;

  // 🔥 Faster for voice (prevents timeout)
  const MAX_STEPS = userId === "desktop-voice" ? 2 : 5;

  let history = [];

  while (steps < MAX_STEPS) {

    // 🧠 STEP 1: decision
    const decision = await askLLMRaw(`
You are an AI AGENT that EXECUTES actions.

GOAL:
${userInput}

PREVIOUS STEPS:
${history.length ? history.join("\n") : "None"}

STRICT RULES:
- You MUST complete the FULL task
- NEVER stop early if multiple steps are required
- ONLY return ONE step at a time
- DO NOT explain anything

FORMAT RULES:
- action MUST be one of: open_app, open_url, google_search, search, none
- input MUST be a separate string
- NEVER combine action and input

Correct:
{"action":"open_app","input":"chrome","done":false}

Wrong:
{"action":"open_app chrome","input":""}

Return ONLY JSON:
{
  "action": "...",
  "input": "...",
  "done": true | false
}
`);

    console.log("Agent decision RAW:", decision);

    let parsed;

    // 🧠 STEP 2: safe parsing
    try {
      const match = decision?.match(/\{[^{}]*\}/);

      if (!match) throw new Error("No JSON");

      parsed = JSON.parse(match[0]);

    } catch (err) {
      console.log("Agent parse failed:", decision);
      return await askLLM(userInput, userId);
    }

    // 🔧 STEP 3: FIX BROKEN OUTPUTS

    // fix "open_app chrome"
    if (parsed.action && parsed.action.includes(" ")) {
      const parts = parsed.action.split(" ");
      parsed.action = parts[0];
      parsed.input = parts.slice(1).join(" ");
    }

    // fix empty input
    if (!parsed.input || parsed.input.trim() === "") {
      parsed.input = userInput;
    }

    // 🚨 STEP 4: prevent early stopping
    if (
      parsed.done === true &&
      steps === 0 &&
      /(and|then)/i.test(userInput)
    ) {
      console.log("Preventing early stop → forcing continuation");
      parsed.done = false;
    }

    // ✅ STEP 5: done → normal response
    if (parsed.done === true || parsed.action === "none") {
      return await askLLM(userInput, userId);
    }

    const toolFn = TOOLS[parsed.action];

    if (!toolFn) {
      console.log("Invalid action:", parsed.action);
      return "Action not supported";
    }

    // 🧠 STEP 6: normalize input
    let input = parsed.input.toLowerCase();

    if (parsed.action === "open_app") {
      if (input.includes("chrome")) input = "chrome";
      if (input.includes("brave")) input = "brave";
      if (input.includes("edge")) input = "edge";
    }

    if (parsed.action === "open_url") {
      if (input.includes("youtube")) input = "youtube.com";
      if (input.includes("google")) input = "google.com";
    }

    if (parsed.action === "google_search") {
      input = input.replace(/search|google/gi, "").trim();
    }

    console.log("Final action:", parsed.action, "| input:", input);

    // 🚨 prevent repeating same step
    const lastStep = history[history.length - 1];
    const currentStep = `${parsed.action} → ${input}`;

    if (lastStep && lastStep.startsWith(currentStep)) {
      console.log("Duplicate step detected → stopping loop");
      return "Done";
    }

    // ⚙️ STEP 7: execute
    const result = await toolFn(input);

    console.log("Tool result:", result);

    // 🔥 CRITICAL: return early for system actions (prevents voice timeout)
    if (["open_app", "open_url", "google_search"].includes(parsed.action)) {
      return result || "Done";
    }

    // 🧠 STEP 8: store history
    history.push(`${parsed.action} → ${input} → ${result}`);

    steps++;
  }

  return "Done";
}