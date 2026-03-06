# Jarvis — Local AI Assistant

A fully local, privacy-first AI assistant available on WhatsApp and Web. Built with Node.js, Ollama, and SearXNG. No cloud AI APIs. Everything runs on your own machine.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐
│  WhatsApp   │     │   WebChat    │
└──────┬──────┘     └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 │
         Node.js Server
                 │
     ┌───────────┼───────────┐
     │           │           │
  Ollama LLM  Tools      Memory
 (mistral:7b)   │        (per user)
                │
     ┌──────────┼──────────┐
     │          │          │
  Reminders  Search     Voice
  (local)  (SearXNG)  (Whisper)
```

---

## Features

- **Multi-platform** — WhatsApp and WebChat with shared memory
- **Wake word detection** — Only responds when you say "Jarvis" (WhatsApp)
- **Voice input** — Transcribes voice notes via local Whisper (WhatsApp + WebChat)
- **AI conversation** — Powered by local Ollama LLM (mistral:7b)
- **Intent classification** — LLM-based router (reminder / search / general)
- **Reminders** — Set, list, and delete reminders via natural language
- **Web search** — Real-time search via local SearXNG, summarized by LLM
- **Persistent memory** — Per-user conversation history saved to disk
- **Memory filtering** — Trivial messages (hi, ok, thanks) not stored
- **Multi-platform auth** — Phone number + secret code links identity across platforms
- **Shared memory** — Same conversation history on WhatsApp and WebChat
- **Pending flush** — Reminders queued while offline fire on restart
- **Fully offline** — No data leaves your machine except WhatsApp itself

---

## Tech Stack

| Component | Purpose |
|---|---|
| whatsapp-web.js | WhatsApp client |
| Ollama (mistral:7b) | Local LLM for AI responses |
| Whisper.cpp | Local speech-to-text |
| SearXNG (Docker) | Self-hosted web search engine |
| Express.js + WebSocket (ws) | HTTP + real-time WebChat server |
| React + Vite | WebChat frontend |
| node-fetch | API calls to Ollama and SearXNG |
| dotenv | Environment variable management |

---

## Project Structure

```
local_AI/
│
├── server.js                  # Main entry point
│
├── core/
│   └── auth.js                # Multi-platform auth (phone + code)
│
├── tools/
│   ├── reminderTool.js        # Reminder logic (add, list, delete, scheduler)
│   ├── searchTool.js          # SearXNG web search integration
│   └── voiceTool.js           # Whisper audio transcription
│
├── webchat/                   # React frontend
│   └── src/
│       └── App.jsx            # Chat UI with auth, text and voice input
│
├── memory/                    # Per-user conversation history (gitignored)
├── users.json                 # VIP user profiles and linked IDs (gitignored)
├── .env                       # Environment variables (gitignored)
└── .env.example               # Example env file
```

### File Breakdown

#### `server.js`
The core of the application. Handles:
- WhatsApp client initialization and QR auth
- Wake word detection
- Voice note download and transcription
- Multi-platform WebSocket server for WebChat
- `askLLM()` — sends queries to Ollama with conversation history
- `processMessage()` — shared message pipeline for all platforms
- `extractReminderDetails()` — parses natural language reminders into JSON
- `classifyIntent()` — LLM-based intent router

#### `core/auth.js`
Handles multi-platform identity:
- `getVIPProfile()` — looks up a user by their platform ID
- `linkWithCode()` — links a new platform ID to a VIP profile using a secret code
- `setPendingAuth()` / `isPendingAuth()` / `clearPendingAuth()` — manages auth state

#### `tools/reminderTool.js`
- `addReminder()`, `listReminders()`, `deleteReminder()`
- `startScheduler()` — fires reminders on time via WhatsApp
- `flushPending()` — sends missed reminders on startup
- `loadReminders()` — loads persisted reminders from disk

#### `tools/searchTool.js`
- `webSearch()` — queries local SearXNG, returns top 3 results as clean text

#### `tools/voiceTool.js`
- `transcribeAudio()` — converts audio to WAV via ffmpeg, transcribes with whisper-cli

#### `webchat/src/App.jsx`
- Auth flow: phone number → secret code → linked device
- Text and voice input (hold mic to record)
- Real-time WebSocket connection
- Transcript replaces voice placeholder after transcription
- Persistent device ID via localStorage

---

## Services & Ports

| Service | Port |
|---|---|
| Jarvis (Node.js) | 5000 |
| Ollama | 11434 |
| SearXNG (Docker/WSL) | 8080 |
| WebChat (Vite dev) | 5173 |

---

## Setup

### 1. Install dependencies
```bash
npm install
cd webchat && npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Start Ollama and pull model
```bash
ollama serve
ollama pull mistral:7b
```

### 4. Start SearXNG (via Docker in WSL)
```bash
sudo service docker start
sudo docker start searxng
```

### 5. Start Jarvis
```bash
node server.js
```

### 6. Start WebChat (dev)
```bash
cd webchat
npm run dev
```

Scan the QR code with WhatsApp when prompted.

---

## Environment Variables

```env
OLLAMA_URL=http://127.0.0.1:11434
MODEL=mistral:7b
PORT=5000
WAKE_WORD=jarvis
VIP_NUMBERS=91XXXXXXXXXX@c.us,91XXXXXXXXXX@c.us
```

---

## User Authentication

VIP users are defined in `users.json`:
```json
{
  "username": {
    "code": "XXXX",
    "linkedIds": [
      "91XXXXXXXXXX@c.us"
    ]
  }
}
```

- **WhatsApp** — phone number auto recognized, no code needed
- **WebChat / other platforms** — enter phone number + code once, then auto recognized forever
- Same memory loaded across all linked platforms

---

## Usage

| Command | Example |
|---|---|
| General question | `Jarvis what time is it` |
| Set reminder | `Jarvis remind me to call mom at 6pm` |
| List reminders | `Jarvis list reminders` |
| Delete reminder | `Jarvis delete reminder 3` |
| Web search | `Jarvis search latest AI news` |
| Voice note | Say "Jarvis what's the weather" |

---

## Startup Script (Windows)

Save as `start.bat` in project root:
```bat
@echo off
wsl sudo service docker start
wsl sudo docker start searxng
start cmd /k "ollama serve"
cd /d C:\xampp\htdocs\aniruddh-project\local_AI
start cmd /k "node server.js"
```

---

## Planned Features

- [ ] Notes tool — save and retrieve notes by voice
- [ ] Weather tool
- [ ] Telegram integration
- [ ] Cloudflare tunnel for public WebChat access
- [ ] Google Calendar integration (via n8n)
- [ ] Email tool (via n8n)
- [ ] SaaS multi-tenant architecture