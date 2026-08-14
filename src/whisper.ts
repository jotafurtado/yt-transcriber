import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export interface WhisperModel {
  id: string;
  label: string;
  size: string;
  description: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "large-v3-turbo-q5_0",
    label: "large-v3-turbo-q5_0",
    size: "547 MiB",
    description: "Best value - near-max quality at half the size. Supports 99 languages, timestamps, and noise robustness. Recommended for most use cases.",
  },
  {
    id: "large-v3-turbo",
    label: "large-v3-turbo",
    size: "1.5 GiB",
    description: "Maximum quality, optimized for speed. Full 99-language support with excellent accuracy on noisy audio and accents.",
  },
  {
    id: "large-v3-q5_0",
    label: "large-v3-q5_0",
    size: "1.1 GiB",
    description: "Quantized large-v3 - top accuracy in compact form. Same capabilities as large-v3 with slightly faster loading.",
  },
  {
    id: "small",
    label: "small",
    size: "466 MiB",
    description: "Balanced speed and accuracy. 99 languages, good for clean audio. Struggles with heavy noise or strong accents.",
  },
  {
    id: "base",
    label: "base",
    size: "142 MiB",
    description: "Fast inference, basic quality. 99 languages but lower accuracy. Useful for quick drafts and pipeline testing.",
  },
  {
    id: "tiny",
    label: "tiny",
    size: "75 MiB",
    description: "Minimal footprint. Lowest accuracy - suitable only for validating the pipeline. Not for production transcripts.",
  },
];

export function getModelPath(modelId: string): string {
  return process.env.WHISPER_MODEL_PATH ?? join(homedir(), ".cache", "whisper.cpp", `ggml-${modelId}.bin`);
}

export async function modelExists(modelId: string): Promise<boolean> {
  try {
    await access(getModelPath(modelId));
    return true;
  } catch {
    return false;
  }
}

export async function checkWhisperCli(): Promise<boolean> {
  const cliPath = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
  try {
    await executeFile(cliPath, ["--version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function downloadModel(
  modelId: string,
  onProgress?: (downloadedMb: number, totalMb: number) => void,
): Promise<void> {
  const modelPath = getModelPath(modelId);
  await mkdir(dirname(modelPath), { recursive: true });

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelId}.bin?download=true`;
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  let downloadedBytes = 0;

  const fileStream = createWriteStream(modelPath);
  const reader = response.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      fileStream.write(value);
      downloadedBytes += value.byteLength;
      onProgress?.(downloadedBytes / (1024 * 1024), totalBytes / (1024 * 1024));
    }
  }

  await new Promise<void>((resolve, reject) => {
    fileStream.on("finish", () => resolve());
    fileStream.on("error", reject);
    fileStream.end();
  });
}

export interface WhisperTranscriptionResult {
  text: string;
  srt: string | null;
}

interface SrtCue {
  startSeconds: number;
  endSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
  text: string;
}

function formatStamp(hours: number, minutes: number, seconds: number): string {
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseSrtCues(srt: string): SrtCue[] {
  const segments = srt.trim().split(/\n\s*\n/);
  const cues: SrtCue[] = [];

  for (const segment of segments) {
    const match = segment.match(
      /(\d{2}):(\d{2}):(\d{2})[,.]\d{3}\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.]\d{3}\s*\n([\s\S]*)/,
    );
    if (!match) continue;

    const text = match[7].trim().replace(/\s+/g, " ");
    if (!text) continue;

    const startH = parseInt(match[1], 10);
    const startM = parseInt(match[2], 10);
    const startS = parseInt(match[3], 10);
    const endH = parseInt(match[4], 10);
    const endM = parseInt(match[5], 10);
    const endS = parseInt(match[6], 10);

    cues.push({
      startSeconds: startH * 3600 + startM * 60 + startS,
      endSeconds: endH * 3600 + endM * 60 + endS,
      hours: startH,
      minutes: startM,
      seconds: startS,
      text,
    });
  }

  return cues;
}

// Sentence terminators that close a paragraph. Abbreviations/decimals (Dr., 3.5) are
// intentionally not treated as boundaries since they rarely end a Whisper cue.
const SENTENCE_END = /[.!?…][")\]]?$/;

// A pause this long between cues (seconds) reads as a natural breath/topic break,
// even without terminal punctuation (e.g. song lyrics, trailing-off speech).
const SILENCE_GAP_SECONDS = 1.2;

// Hard cap so unpunctuated audio (song lyrics, rambling speech) still gets broken
// into readable chunks instead of one giant paragraph.
const MAX_PARAGRAPH_CHARS = 350;

/**
 * Converts raw Whisper SRT cues (one short fragment per audio chunk) into
 * natural, sentence-grouped paragraphs with a leading timestamp, mirroring
 * the readable style Gemini produces directly. Breaks on sentence punctuation,
 * detected pauses between cues, or a max length safety cap.
 */
export function srtToTimestampedText(srt: string): string {
  const cues = parseSrtCues(srt);
  if (cues.length === 0) return "";

  const paragraphs: string[] = [];
  let bufferStart: SrtCue | null = null;
  let bufferText: string[] = [];
  let bufferChars = 0;
  let previousCue: SrtCue | null = null;

  const flush = () => {
    if (!bufferStart || bufferText.length === 0) return;
    const stamp = formatStamp(bufferStart.hours, bufferStart.minutes, bufferStart.seconds);
    paragraphs.push(`[${stamp}] ${bufferText.join(" ")}`);
    bufferStart = null;
    bufferText = [];
    bufferChars = 0;
  };

  for (const cue of cues) {
    const gap = previousCue ? cue.startSeconds - previousCue.endSeconds : 0;
    if (previousCue && gap >= SILENCE_GAP_SECONDS) {
      flush();
    }

    if (!bufferStart) bufferStart = cue;
    bufferText.push(cue.text);
    bufferChars += cue.text.length + 1;
    previousCue = cue;

    if (SENTENCE_END.test(cue.text) || bufferChars >= MAX_PARAGRAPH_CHARS) {
      flush();
    }
  }
  flush();

  return paragraphs.join("\n\n");
}
export async function transcribeWithWhisper(
  audioFilePath: string,
  workDirectory: string,
  modelId: string,
  language: string,
): Promise<WhisperTranscriptionResult> {
  const wavPath = join(workDirectory, "whisper-input.wav");
  const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

  // yt-dlp delivers M4A/WebM; whisper-cli requires 16 kHz mono WAV
  await executeFile(
    ffmpegPath,
    ["-hide_banner", "-loglevel", "error", "-i", audioFilePath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const modelPath = getModelPath(modelId);
  const whisperCliPath = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
  const outputPath = join(workDirectory, "whisper-output");

  await executeFile(
    whisperCliPath,
    ["-m", modelPath, "-f", wavPath, "-l", language, "-t", "8", "-otxt", "-osrt", "-of", outputPath, "-np"],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const text = await readFile(`${outputPath}.txt`, "utf8");
  let srt: string | null = null;
  try {
    srt = await readFile(`${outputPath}.srt`, "utf8");
  } catch {
    // SRT might not have been generated
  }

  await rm(wavPath, { force: true });
  await rm(`${outputPath}.txt`, { force: true });
  await rm(`${outputPath}.srt`, { force: true });

  return { text, srt };
}
