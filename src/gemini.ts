import { setTimeout as sleep } from "node:timers/promises";
import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";

const FILE_POLL_INTERVAL_MS = 3_000;

const TRANSCRIPTION_PROMPT = [
  "Transcribe the audio of this video in its original spoken language keeping maximum fidelity to the spoken content.",
  "",
  "Guidelines:",
  "1. Add timestamps at the beginning of each relevant sentence or paragraph in [MM:SS] or [HH:MM:SS] format (e.g., [01:23] or [00:05:12]).",
  "2. Identify speakers whenever there is a conversation or multiple people speaking (e.g., 'Speaker 1:', 'Speaker 2:').",
  "3. Apply proper grammar correction and punctuation to make the text flow well, but preserve original words, slang, or technical terms.",
  "4. Return ONLY the resulting transcription with timestamps and corresponding dialogue, with no introductory or concluding text (e.g., do not write 'Here is the transcription').",
].join("\n");

export interface UploadedFile {
  name: string;
}

export interface ProcessedFile {
  uri: string;
  mimeType: string;
}

export async function uploadAudio(
  ai: GoogleGenAI,
  filePath: string,
  mimeType: string,
): Promise<UploadedFile> {
  const uploaded = await ai.files.upload({ file: filePath, config: { mimeType } });

  if (!uploaded.name) {
    throw new Error("Gemini did not return an identifier for the uploaded file.");
  }

  return { name: uploaded.name };
}

export async function waitForProcessing(ai: GoogleGenAI, fileName: string): Promise<ProcessedFile> {
  let file = await ai.files.get({ name: fileName });

  while (file.state?.toString() === "PROCESSING") {
    await sleep(FILE_POLL_INTERVAL_MS);
    file = await ai.files.get({ name: fileName });
  }

  const state = file.state?.toString();
  if (state === "FAILED") {
    throw new Error("Audio processing failed on Gemini servers.");
  }
  if (state !== "ACTIVE") {
    throw new Error(`Gemini file ended in an unexpected state: ${state ?? "unknown"}.`);
  }

  if (!file.uri || !file.mimeType) {
    throw new Error("Gemini did not return a URI or MIME type for the processed file.");
  }

  return { uri: file.uri, mimeType: file.mimeType };
}

export async function streamTranscription(
  ai: GoogleGenAI,
  uri: string,
  mimeType: string,
  model: string,
): Promise<string> {
  const responseStream = await ai.models.generateContentStream({
    model,
    contents: createUserContent([createPartFromUri(uri, mimeType), TRANSCRIPTION_PROMPT]),
  });

  let transcription = "";
  for await (const chunk of responseStream) {
    const text = chunk.text ?? "";
    if (text) {
      process.stdout.write(text);
      transcription += text;
    }
  }
  process.stdout.write("\n");

  return transcription;
}

export async function deleteRemoteFile(ai: GoogleGenAI, fileName: string): Promise<void> {
  await ai.files.delete({ name: fileName });
}
