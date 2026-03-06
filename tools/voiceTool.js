import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

const WHISPER_CLI  = "./voice/whisper/whisper-cli.exe";
const WHISPER_MODEL = "./voice/whisper/models/ggml-base.bin";
const FFMPEG       = "./voice/ffmpeg/ffmpeg.exe";
const TEMP_DIR     = "./temp";

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

export async function transcribeAudio(mediaData, mimetype) {
  const timestamp = Date.now();
  const inputPath = path.join(TEMP_DIR, `input_${timestamp}.ogg`);
  const wavPath   = path.join(TEMP_DIR, `input_${timestamp}.wav`);

  try {
    // 1. Save the raw audio from WhatsApp
    fs.writeFileSync(inputPath, Buffer.from(mediaData, "base64"));

    // 2. Convert ogg → wav using ffmpeg
    await execAsync(`"${FFMPEG}" -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`);

    // 3. Transcribe with whisper-cli
    const { stdout } = await execAsync(
      `"${WHISPER_CLI}" -m "${WHISPER_MODEL}" -f "${wavPath}" --no-timestamps -l auto`
    );

    // 4. Clean up temp files
    fs.unlinkSync(inputPath);
    fs.unlinkSync(wavPath);

    return stdout.trim();

  } catch (err) {
    console.log("Transcription error:", err.message);
    // Clean up on error
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    return null;
  }
}