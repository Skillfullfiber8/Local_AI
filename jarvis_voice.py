import os
import sys
import json
import time
import wave
import asyncio
import tempfile
import subprocess
import numpy as np
import sounddevice as sd
import soundfile as sf
import speech_recognition as sr
import websockets

# ============================================================
# CONFIG — update these paths if needed
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WHISPER_EXE   = os.path.join(BASE_DIR, "voice", "whisper", "whisper-cli.exe")
WHISPER_MODEL = os.path.join(BASE_DIR, "voice", "whisper", "models", "ggml-base.bin")
PIPER_EXE     = os.path.join(BASE_DIR, "voice", "piper", "piper.exe")
PIPER_MODEL   = os.path.join(BASE_DIR, "voice", "piper", "models", "en_US-lessac-medium.onnx")

WS_URL        = "wss://192.168.0.161:5001"   # your Jarvis server
WAKE_WORD     = "jarvis"

SAMPLE_RATE   = 16000
SILENCE_LIMIT = 2       # seconds of silence before stopping recording
MAX_RECORD    = 15      # max seconds to record a command
THRESHOLD     = 0.01    # mic energy threshold for silence detection

# ============================================================
# SPEAK via Piper
# ============================================================

def speak(text):
    print(f"Jarvis: {text}")
    try:
        out_path = os.path.join(BASE_DIR, "temp_reply.wav")
        proc = subprocess.run(
            [PIPER_EXE, "--model", PIPER_MODEL, "--output_file", out_path],
            input=text.encode("utf-8"),
            capture_output=True
        )
        if os.path.exists(out_path):
            data, sr_rate = sf.read(out_path)
            sd.play(data, sr_rate)
            sd.wait()
    except Exception as e:
        print(f"Piper error: {e}")

# ============================================================
# TRANSCRIBE via whisper-cli
# ============================================================

def transcribe(wav_path):
    try:
        result = subprocess.run(
            [WHISPER_EXE, "-m", WHISPER_MODEL, "-f", wav_path],
            capture_output=True, text=True, timeout=30
        )
        # Extract text from lines like: [00:00:00.000 --> 00:00:03.000]   Some text here
        transcript_lines = []
        for line in result.stdout.splitlines():
            if "-->" in line and "]" in line:
                text = line.split("]")[-1].strip()
                if text:
                    transcript_lines.append(text)
        transcript = " ".join(transcript_lines).strip()
        print(f"Whisper transcript: {transcript}")
        return transcript
    except Exception as e:
        print(f"Whisper error: {e}")
        return ""

# ============================================================
# RECORD command after wake word detected
# ============================================================

def record_command():
    print("Listening for command...")
    frames = []
    silence_frames = 0
    silence_limit_frames = int(SILENCE_LIMIT * SAMPLE_RATE / 512)
    speech_detected = False
    wait_for_speech_frames = int(5 * SAMPLE_RATE / 512)  # wait up to 5s for speech to start
    waited_frames = 0

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='float32', blocksize=512) as stream:
        start = time.time()
        while time.time() - start < MAX_RECORD:
            block, _ = stream.read(512)
            energy = np.sqrt(np.mean(block**2))
            print(f"Energy: {energy:.4f}", end="\r")  # debug — shows mic energy live

            if not speech_detected:
                # Wait until user starts speaking
                if energy > THRESHOLD:
                    speech_detected = True
                    print("\nSpeech detected, recording...")
                else:
                    waited_frames += 1
                    if waited_frames > wait_for_speech_frames:
                        print("\nNo speech detected.")
                        return ""
                    continue

            frames.append(block.copy())

            if energy < THRESHOLD:
                silence_frames += 1
                if silence_frames > silence_limit_frames:
                    break
            else:
                silence_frames = 0

    if not frames:
        return ""

    audio = np.concatenate(frames, axis=0)
    wav_path = os.path.join(BASE_DIR, "temp_command.wav")

    with wave.open(wav_path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes((audio * 32767).astype(np.int16).tobytes())

    transcript = transcribe(wav_path)
    return transcript.strip()

    with wave.open(wav_path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes((audio * 32767).astype(np.int16).tobytes())

    transcript = transcribe(wav_path)
    return transcript.strip()

# ============================================================
# SEND to Jarvis server via WebSocket
# ============================================================

async def ask_jarvis(text):
    try:
        async with websockets.connect("ws://127.0.0.1:5001") as ws:
            await ws.send(json.dumps({
                "type": "message",
                "payload": { "text": text }
            }))
            reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            return reply.get("text", "")
    except Exception as e:
        print(f"WebSocket error: {e}")
        return "Could not reach Jarvis server."
    
# WAKE WORD LISTENER
# ============================================================

def listen_for_wake_word():
    recognizer = sr.Recognizer()
    mic = sr.Microphone(sample_rate=SAMPLE_RATE)

    recognizer.energy_threshold = 300
    recognizer.dynamic_energy_threshold = True
    recognizer.pause_threshold = 0.8

    print(f"Jarvis desktop ready. Say '{WAKE_WORD.capitalize()}' to activate.")

    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)

    while True:
        try:
            with mic as source:
                audio = recognizer.listen(source, timeout=5, phrase_time_limit=4)

            text = recognizer.recognize_google(audio).lower()
            print(f"Heard: {text}")

            if WAKE_WORD in text:
                speak("Yes?")
                command = record_command()
                print(f"Command: {command}")

                if not command:
                    speak("I didn't catch that.")
                    continue

                if WAKE_WORD in command.lower():
                    command = command.lower().replace(WAKE_WORD, "").strip()

                print(f"Sending to Jarvis: {command}")
                reply = asyncio.run(ask_jarvis(command))
                speak(reply)

        except sr.WaitTimeoutError:
            pass
        except sr.UnknownValueError:
            pass
        except KeyboardInterrupt:
            print("Stopped.")
            sys.exit(0)
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(1)

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    # Quick config check
    for label, path in [("Whisper exe", WHISPER_EXE), ("Piper exe", PIPER_EXE), ("Piper model", PIPER_MODEL)]:
        if not os.path.exists(path):
            print(f"ERROR: {label} not found at {path}")
            sys.exit(1)

    listen_for_wake_word()