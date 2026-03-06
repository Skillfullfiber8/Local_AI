import { useState, useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_API_URL || "ws://localhost:5000";

function getDeviceId() {
  let id = localStorage.getItem("jarvis_device_id");
  if (!id) {
    id = "webchat:" + Math.random().toString(36).slice(2);
    localStorage.setItem("jarvis_device_id", id);
  }
  return id;
}

const DEVICE_ID = getDeviceId();

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting");
  const [authStep, setAuthStep] = useState("phone"); // phone | code | done
  const [phone, setPhone] = useState("");
  const [ws, setWs] = useState(null);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef(null);
  const mediaRef = useRef(null);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      setStatus("need_auth");
      // Check if device already linked
      socket.send(JSON.stringify({
        type: "auth_check",
        payload: { platformId: DEVICE_ID }
      }));
    };

    socket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "auth_success") {
        setStatus("ready");
        setAuthStep("done");
        addMessage("jarvis", `Identity verified. Welcome, ${data.name}!`);
      } else if (data.type === "auth_fail") {
        setAuthStep("code");
        addMessage("jarvis", "Invalid code. Try again.");
      } else if (data.type === "need_auth") {
        setAuthStep("phone");
        addMessage("jarvis", "Enter your phone number (with country code) to get started.");
      } else if (data.type === "transcript") {
        // Replace the "Transcribing..." placeholder with actual transcript
        setMessages(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "user" && updated[i].text === "🎤 Transcribing...") {
              updated[i] = { role: "user", text: data.text };
              break;
            }
          }
          return updated;
        });
      } else if (data.type === "reply") {
        addMessage("jarvis", data.text);
      } else if (data.type === "error") {
        addMessage("jarvis", data.text);
      }
    };

    socket.onclose = () => setStatus("connecting");
    setWs(socket);
    return () => socket.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addMessage(role, text) {
    setMessages(prev => [...prev, { role, text }]);
  }

  function send() {
    if (!input.trim() || !ws) return;
    const text = input.trim();
    setInput("");
    addMessage("user", text);

    if (authStep === "phone") {
      setPhone(text);
      setAuthStep("code");
      ws.send(JSON.stringify({
        type: "auth_phone",
        payload: { platformId: DEVICE_ID, phone: text }
      }));
    } else if (authStep === "code") {
      ws.send(JSON.stringify({
        type: "auth",
        payload: { platformId: DEVICE_ID, phone, code: text }
      }));
    } else {
      ws.send(JSON.stringify({
        type: "message",
        payload: { platformId: DEVICE_ID, text }
      }));
    }
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1];
        ws.send(JSON.stringify({
          type: "voice",
          payload: { platformId: DEVICE_ID, audio: base64, mimetype: "audio/webm" }
        }));
        addMessage("user", "🎤 Transcribing...");
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  const placeholder = authStep === "phone"
    ? "Enter phone number e.g. 919786210101"
    : authStep === "code"
    ? "Enter your code..."
    : "Message Jarvis...";

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.dot(status)} />
        <b>Jarvis</b>
        <span style={s.statusText}>
          {status === "ready" ? "Online" : status === "need_auth" ? "Auth required" : "Connecting..."}
        </span>
      </div>

      <div style={s.messages}>
        {messages.map((m, i) => (
          <div key={i} style={s.bubble(m.role)}>
            <span style={s.label}>{m.role === "jarvis" ? "Jarvis" : "You"}</span>
            <p style={s.text}>{m.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={placeholder}
        />
        {authStep === "done" && (
          <button
            style={s.mic(recording)}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
          >
            🎤
          </button>
        )}
        <button style={s.btn} onClick={send}>Send</button>
      </div>
    </div>
  );
}

const s = {
  container: { display: "flex", flexDirection: "column", height: "100vh", maxWidth: 600, margin: "0 auto", fontFamily: "sans-serif", background: "#0f0f0f", color: "#eee" },
  header: { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#1a1a1a", borderBottom: "1px solid #333" },
  dot: (st) => ({ width: 10, height: 10, borderRadius: "50%", background: st === "ready" ? "#4caf50" : st === "need_auth" ? "#ff9800" : "#f44336" }),
  statusText: { marginLeft: "auto", fontSize: 12, color: "#888" },
  messages: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  bubble: (r) => ({ alignSelf: r === "jarvis" ? "flex-start" : "flex-end", background: r === "jarvis" ? "#1e1e1e" : "#1a3a5c", borderRadius: 12, padding: "8px 12px", maxWidth: "80%" }),
  label: { fontSize: 11, color: "#888" },
  text: { margin: "4px 0 0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  inputRow: { display: "flex", padding: 12, gap: 8, borderTop: "1px solid #333", background: "#1a1a1a", position: "sticky", bottom: 0 },
  input: { flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #333", background: "#0f0f0f", color: "#eee", fontSize: 14, outline: "none" },
  mic: (rec) => ({ padding: "10px 14px", borderRadius: 8, border: "none", background: rec ? "#c0392b" : "#2a2a2a", color: "#eee", cursor: "pointer", fontSize: 16 }),
  btn: { padding: "10px 18px", borderRadius: 8, border: "none", background: "#1a3a5c", color: "#eee", cursor: "pointer", fontSize: 14 }
};