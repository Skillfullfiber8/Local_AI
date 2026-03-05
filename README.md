# Jarvis — Local AI WhatsApp Assistant

A fully local, privacy-first AI assistant that runs on WhatsApp. Built with Node.js, Ollama, and SearXNG. No cloud AI APIs. Everything runs on your own machine.

---

## Architecture

```
┌──────────────┐
│  WhatsApp    │
└──────┬───────┘
       │
  Node.js Server (server.js)
       │
  ┌────┴─────────────────┐
  │                       │
Ollama LLM           Tool Router
(mistral:7b)               │
                 ┌────────┼────────┐
                 │        │        │
            Reminders  Web Search  (Tasks - planned)
            (local)   (SearXNG)    (n8n)
```

---

## Features

- **Wake word detection** — Only responds when you say "Jarvis"
- **AI conversation** — Powered by a local Ollama LLM (phi3:mini / llama3:8b)
- **Reminders** — Set, list, and delete reminders via natural language
- **Web search** — Real-time search via local SearXNG instance, summarized by LLM
- **Pending flush** — Reminders queued while offline fire when bot restarts
- **Multi-user** — Reminders and data scoped per WhatsApp contact
- **Fully offline** — No data leaves your machine except WhatsApp itself

---

## Tech Stack

| Component | Purpose |
|---|---|
| whatsapp-web.js | WhatsApp client |
| Ollama (phi3:mini) | Local LLM for AI responses |
| SearXNG (Docker) | Self-hosted web search engine |
| Express.js | Lightweight HTTP server |
| node-fetch | API calls to Ollama and SearXNG |
| node-schedule | Reminder scheduling |

---

## Project Structure

```
local_AI/
│
├── server.js                  # Main entry point
│
└── tools/
    ├── reminderTool.js        # Reminder logic (add, list, delete, scheduler)
    └── searchTool.js          # SearXNG web search integration
```

### File Breakdown

#### `server.js`
The core of the application. Handles:
- WhatsApp client initialization and QR auth
- Wake word detection (`Jarvis`)
- Intent routing — decides whether to call reminder tool, search tool, or raw LLM
- `askLLM()` — sends general queries to Ollama and returns a response
- `extractReminderDetails()` — uses Ollama to parse natural language reminders into structured JSON
- Express server on port `5000`

#### `tools/reminderTool.js`
Handles all reminder functionality:
- `addReminder()` — saves a reminder with user ID, task, and datetime
- `listReminders()` — returns all active reminders for a user
- `deleteReminder()` — removes a reminder by ID
- `startScheduler()` — checks every minute and fires due reminders via WhatsApp
- `flushPending()` — on startup, immediately sends any reminders that fired while the bot was offline
- `loadReminders()` — loads persisted reminders from disk on startup

#### `tools/searchTool.js`
Handles web search:
- `webSearch()` — queries the local SearXNG instance
- Returns top 3 results (title + summary) as clean text
- Result is passed to Ollama for summarization before replying

---

## Services & Ports

| Service | Port |
|---|---|
| Jarvis (Node.js) | 5000 |
| Ollama | 11434 |
| SearXNG (Docker/WSL) | 8080 |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Start Ollama and pull model
```bash
ollama serve
ollama pull phi3:mini
```

### 3. Start SearXNG (via Docker in WSL)
```bash
sudo service docker start
sudo docker start searxng
```

### 4. Start Jarvis
```bash
node server.js
```

Scan the QR code with WhatsApp when prompted.

---

## Usage

| Command | Example |
|---|---|
| General question | `Jarvis what time is it` |
| Set reminder | `Jarvis remind me to call mom at 6pm` |
| List reminders | `Jarvis list reminders` |
| Delete reminder | `Jarvis delete reminder 3` |
| Web search | `Jarvis search latest AI news` |

---

## Planned Features

- [ ] n8n integration for task automation (send emails, calendar events)
- [ ] Conversation memory (per-user chat history)
- [ ] Weather tool
- [ ] Notes tool
- [ ] Multi-model support (switch models via WhatsApp)