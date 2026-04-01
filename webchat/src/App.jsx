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
  const [authStep, setAuthStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [ws, setWs] = useState(null);
  const [recording, setRecording] = useState(false);
  const [typing, setTyping] = useState(false);
  const [viewHeight, setViewHeight] = useState(window.innerHeight);
  const bottomRef = useRef(null);
  const mediaRef = useRef(null);
  const inputRef = useRef(null);
  const msgsRef = useRef(null);

  // Fix mobile viewport height when keyboard appears
  useEffect(() => {
    const handler = () => setViewHeight(window.visualViewport?.height ?? window.innerHeight);
    window.visualViewport?.addEventListener("resize", handler);
    window.visualViewport?.addEventListener("scroll", handler);
    window.addEventListener("resize", handler);
    return () => {
      window.visualViewport?.removeEventListener("resize", handler);
      window.visualViewport?.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      setStatus("need_auth");
      socket.send(JSON.stringify({ type: "auth_check", payload: { platformId: DEVICE_ID } }));
    };
    socket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "auth_success") {
        setStatus("ready"); setAuthStep("done");
        addMessage("jarvis", `Welcome back, ${data.name}.`);
      } else if (data.type === "need_code") {
        setAuthStep("code");
        addMessage("jarvis", "Phone found. Enter your secret code.");
      } else if (data.type === "auth_fail") {
        setAuthStep("phone");
        addMessage("jarvis", "Verification failed. Check your details.");
      } else if (data.type === "need_auth") {
        setAuthStep("phone");
        addMessage("jarvis", "Enter your phone number with country code.");
      } else if (data.type === "transcript") {
        setMessages(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "user" && updated[i].text === "🎤 Transcribing...") {
              updated[i] = { ...updated[i], text: data.text };
              break;
            }
          }
          return updated;
        });
      } else if (data.type === "reply") {
        setTyping(false);
        addMessage("jarvis", data.text);
      } else if (data.type === "error") {
        setTyping(false);
        addMessage("jarvis", data.text);
      }
    };
    socket.onclose = () => { setStatus("connecting"); setTyping(false); };
    setWs(socket);
    return () => socket.close();
  }, []);

  function addMessage(role, text) {
    setMessages(prev => [...prev, { role, text, time: new Date() }]);
  }

  function send() {
    if (!input.trim() || !ws) return;
    const text = input.trim();
    setInput("");
    addMessage("user", text);
    if (authStep === "phone") {
      setPhone(text);
      ws.send(JSON.stringify({ type: "auth_phone", payload: { platformId: DEVICE_ID, phone: text } }));
    } else if (authStep === "code") {
      ws.send(JSON.stringify({ type: "auth", payload: { platformId: DEVICE_ID, phone, code: text } }));
    } else {
      setTyping(true);
      ws.send(JSON.stringify({ type: "message", payload: { platformId: DEVICE_ID, text } }));
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Tap once to start, tap again to stop
  async function toggleRecording() {
    if (recording) {
      // Stop recording
      mediaRef.current?.stop();
      setRecording(false);
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(",")[1];
            setTyping(true);
            ws.send(JSON.stringify({ type: "voice", payload: { platformId: DEVICE_ID, audio: base64, mimetype: "audio/webm" } }));
            addMessage("user", "🎤 Transcribing...");
          };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRef.current = recorder;
        recorder.start();
        setRecording(true);
      } catch {
        addMessage("jarvis", "Microphone access denied.");
      }
    }
  }

  const placeholder = authStep === "phone" ? "Phone e.g. 919786210101" : authStep === "code" ? "Secret code..." : "Message Jarvis...";
  const statusColor = status === "ready" ? "#22c55e" : status === "need_auth" ? "#f59e0b" : "#ef4444";
  const statusLabel = status === "ready" ? "Online" : status === "need_auth" ? "Auth required" : "Connecting...";

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; background: #0a0a0a; overflow: hidden; }
        #root { height: 100%; }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
          50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
        input { -webkit-appearance: none; border-radius: 0; }
      `}</style>

      <div style={{
        display: "flex",
        flexDirection: "column",
        height: viewHeight,
        maxWidth: 680,
        margin: "0 auto",
        background: "#0a0a0a",
        color: "#f1f1f1",
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: "hidden",
        position: "fixed",
        top: 0, left: 0, right: 0,
        bottom: 0,
      }}>

        {/* Header */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#111", borderBottom: "1px solid #1f1f1f" }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, #1e3a5f, #0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>J</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Jarvis</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#666" }}>{statusLabel}</span>
            </div>
          </div>
          {/* Recording indicator in header */}
          {recording && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 12, padding: "4px 10px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" }} />
              <span style={{ fontSize: 11, color: "#ef4444" }}>Recording</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={msgsRef} style={{ flex: 1, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8, WebkitOverflowScrolling: "touch" }}>

          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 8, color: "#333" }}>
              <div style={{ fontSize: 44 }}>⚡</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#555" }}>Jarvis is ready</div>
              <div style={{ fontSize: 12, color: "#333" }}>Your local AI assistant</div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "jarvis" ? "flex-start" : "flex-end" }}>
              <div style={{
                maxWidth: "80%",
                background: m.role === "jarvis" ? "#161616" : "linear-gradient(135deg, #1e3a5f, #0ea5e9)",
                borderRadius: m.role === "jarvis" ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                padding: "9px 13px",
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                border: m.role === "jarvis" ? "1px solid #222" : "none",
              }}>
                {m.text}
              </div>
              <div style={{ fontSize: 10, color: "#333", marginTop: 3, paddingLeft: 2, paddingRight: 2 }}>
                {m.time?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}

          {typing && (
            <div style={{ display: "flex" }}>
              <div style={{ background: "#161616", border: "1px solid #222", borderRadius: "4px 16px 16px 16px", padding: "12px 16px", display: "flex", gap: 5, alignItems: "center" }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#444", animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} style={{ height: 1 }} />
        </div>

        {/* Input bar */}
        <div style={{ flexShrink: 0, padding: "8px 10px 12px", background: "#111", borderTop: "1px solid #1f1f1f" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#161616", borderRadius: 26, padding: "5px 5px 5px 14px", border: "1px solid #252525" }}>
            <input
              ref={inputRef}
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#f1f1f1", fontSize: 14, padding: "5px 0", minWidth: 0 }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={placeholder}
              autoComplete="off"
              autoCorrect="off"
            />
            {authStep === "done" && (
              <button
                onClick={toggleRecording}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none",
                  background: recording ? "#ef4444" : "#1e2a3a",
                  color: "#fff", fontSize: 15, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "background 0.2s",
                  animation: recording ? "pulse 1s infinite" : "none"
                }}
              >
                {recording ? "⏹" : "🎤"}
              </button>
            )}
            <button
              onClick={send}
              style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: input.trim() ? "linear-gradient(135deg, #1e3a5f, #0ea5e9)" : "#1e2a3a", color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s" }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </>
  );
}