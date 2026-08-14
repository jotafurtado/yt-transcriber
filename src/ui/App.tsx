import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { pathToFileURL } from "node:url";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { downloadYouTubeAudio } from "../youtube.js";
import { deleteRemoteFile, uploadAudio, waitForProcessing } from "../gemini.js";
import {
  checkWhisperCli,
  downloadModel,
  getModelPath,
  modelExists,
  srtToTimestampedText,
  transcribeWithWhisper,
  WHISPER_MODELS,
} from "../whisper.js";
import { formatFileSize, getMimeType, slugifyFilename } from "../utils.js";

// --- ASCII Art Logo (block / dense) ---
const LOGO = [
  "░█░█░█▀█░█░█░░░▀█▀░█░█░█▀▄░█▀▀",
  "░░█░░█░█░█░█░░░░█░░█░█░█▀▄░█▀▀",
  "░░▀░░▀▀▀░▀▀▀░░░░▀░░▀▀▀░▀▀░░▀▀▀",
  "░▀█▀░█▀▄░█▀█░█▀█░█▀▀░█▀▀░█▀▄░▀█▀░█▀▄░█▀▀░█▀▄",
  "░░█░░█▀▄░█▀█░█░█░▀▀█░█░░░█▀▄░░█░░█▀▄░█▀▀░█▀▄",
  "░░▀░░▀░▀░▀░▀░▀░▀░▀▀▀░▀▀▀░▀░▀░▀▀▀░▀▀░░▀▀▀░▀░▀",
].join("\n");
// Warp's TERM_PROGRAM=WarpTerminal is not allowlisted by supports-hyperlinks,
// so ink-link/terminal-link returns plain text (fallback). Force OSC 8 anyway:
// Warp does support OSC 8 — Cmd+click opens file:// links.
const hyperlink = (text: string, url: string) =>
  `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;


// Clamp the app to the terminal width so bordered boxes and pasted/wrapped text
// never overflow past the right edge, even with long titles or pasted input.
function getTerminalWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(columns, 100)) - 2;
}

type Step =
  | "url"
  | "engine"
  | "whisper_model"
  | "whisper_lang"
  | "keep_audio"
  | "download_confirm"
  | "processing";

export interface AppProps {
  initialUrl?: string;
  initialEngine?: "gemini" | "whisper";
  initialModel?: string;
  initialLanguage?: string;
  outputDir?: string;
  keepAudioFlag?: boolean;
}

interface SelectItem {
  label: string;
  value: string;
  description?: string;
}

export const App: React.FC<AppProps> = ({
  initialUrl,
  initialEngine,
  initialModel,
  initialLanguage,
  outputDir = "output",
  keepAudioFlag,
}) => {
  const { exit } = useApp();
  const isInteractive = Boolean(process.stdin.isTTY);
  const contentWidth = getTerminalWidth();

  // State
  const [url, setUrl] = useState<string>(initialUrl ?? "");
  const [engine, setEngine] = useState<"gemini" | "whisper" | undefined>(initialEngine);
  const [model, setModel] = useState<string>(
    initialModel ?? (initialEngine === "whisper" ? "large-v3-turbo-q5_0" : "gemini-3.5-flash"),
  );
  const [language, setLanguage] = useState<string>(initialLanguage ?? "auto");
  const [keepAudio, setKeepAudio] = useState<boolean>(keepAudioFlag ?? false);

  // Determine starting step
  const getInitialStep = (): Step => {
    if (!initialUrl) return "url";
    if (!initialEngine) return "engine";
    if (initialEngine === "whisper" && !initialModel) return "whisper_model";
    if (initialEngine === "whisper" && !initialLanguage) return "whisper_lang";
    if (keepAudioFlag === undefined && isInteractive) return "keep_audio";
    return "processing";
  };

  const [step, setStep] = useState<Step>(getInitialStep);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Processing state
  const [activeStage, setActiveStage] = useState<number>(0);
  const [stageLogs, setStageLogs] = useState<{ text: string; status: "ok" | "info" | "wait" }[]>([]);
  const [streamContent, setStreamContent] = useState<string>("");
  const [completedInfo, setCompletedInfo] = useState<{
    title: string;
    url: string;
    outputPath: string;
    size: string;
    engine: string;
    reused: boolean;
  } | null>(null);

  const addLog = (text: string, status: "ok" | "info" | "wait" = "info") => {
    setStageLogs((prev) => [...prev, { text, status }]);
  };

  const updateLastLog = (text: string, status: "ok" | "info" | "wait" = "info") => {
    setStageLogs((prev) => {
      if (prev.length === 0) return [{ text, status }];
      const updated = [...prev];
      updated[updated.length - 1] = { text, status };
      return updated;
    });
  };

  // Ctrl+C handling - only active when running in TTY
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        exit();
      }
    },
    { isActive: isInteractive },
  );

  // Step 1: URL submit
  const handleUrlSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setErrorMessage("Please enter a valid YouTube URL.");
      return;
    }
    setUrl(trimmed);
    setErrorMessage(null);
    if (!engine) {
      setStep("engine");
    } else if (engine === "whisper" && !model) {
      setStep("whisper_model");
    } else {
      setStep("keep_audio");
    }
  };

  // Step 2: Engine select
  const handleEngineSelect = (item: SelectItem) => {
    const selectedEngine = item.value as "gemini" | "whisper";
    setEngine(selectedEngine);
    if (selectedEngine === "whisper") {
      setModel("large-v3-turbo-q5_0");
      setStep("whisper_model");
    } else {
      setModel("gemini-3.5-flash");
      if (keepAudioFlag === undefined && isInteractive) {
        setStep("keep_audio");
      } else {
        setStep("processing");
      }
    }
  };

  // Step 3: Whisper model select
  const handleWhisperModelSelect = (item: SelectItem) => {
    setModel(item.value);
    setStep("whisper_lang");
  };

  // Step 4: Whisper lang select
  const handleWhisperLangSelect = (item: SelectItem) => {
    setLanguage(item.value);
    if (keepAudioFlag === undefined && isInteractive) {
      setStep("keep_audio");
    } else {
      setStep("processing");
    }
  };

  // Step 5: Keep audio select
  const handleKeepAudioSelect = (item: SelectItem) => {
    setKeepAudio(item.value === "yes");
    setStep("processing");
  };

  // Step 6: Download model confirm
  const handleDownloadConfirmSelect = (item: SelectItem) => {
    if (item.value === "yes") {
      setStep("processing");
    } else {
      setErrorMessage("Operation cancelled: Whisper model download rejected.");
      exit();
    }
  };

  // Check model existence before processing
  useEffect(() => {
    if (step === "processing" && engine === "whisper") {
      modelExists(model).then((exists: boolean) => {
        if (!exists && isInteractive) {
          setStep("download_confirm");
        }
      });
    }
  }, [step, engine, model, isInteractive]);

  // Main Processing Runner
  useEffect(() => {
    if (step !== "processing") return;

    let isSubscribed = true;

    const runProcess = async () => {
      let tempDir: string | undefined;
      let audioFilePath: string | undefined;
      let audioWasReused = false;

      try {
        const outDirResolved = resolve(outputDir);
        await mkdir(outDirResolved, { recursive: true });

        // 1. Download YouTube Audio (or reuse existing)
        setActiveStage(1);
        addLog("Extracting audio from YouTube...", "wait");

        tempDir = await mkdtemp(join(tmpdir(), "yt-transcriber-"));

        // If keepAudio is true, check output dir for existing audio first
        const existingDir = keepAudio ? outDirResolved : undefined;
        const audio = await downloadYouTubeAudio(url, tempDir, existingDir);
        audioFilePath = audio.filePath;
        audioWasReused = audio.reused ?? false;

        if (!audioFilePath) {
          throw new Error("Failed to download audio file.");
        }
        const stats = await stat(audioFilePath);

        if (!isSubscribed) return;

        if (audioWasReused) {
          addLog(`Audio file found locally (reused): ${basename(audioFilePath)} (${formatFileSize(stats.size)})`, "ok");
        } else {
          addLog(`Audio extracted: "${audio.title}" (${formatFileSize(stats.size)})`, "ok");
        }

        let resultText = "";

        if (engine === "gemini") {
          // 2. Upload to Gemini
          setActiveStage(2);
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY not found. Set it in .env or environment.");
          }

          const ai = new GoogleGenAI({ apiKey });
          const mimeType = getMimeType(audioFilePath);

          addLog("Uploading audio to Gemini...", "wait");
          const uploaded = await uploadAudio(ai, audioFilePath, mimeType);

          addLog("Processing audio on Gemini servers...", "wait");
          const processed = await waitForProcessing(ai, uploaded.name);
          addLog("Audio processed by Gemini", "ok");

          // 3. Stream Transcription
          setActiveStage(3);
          addLog("Transcribing in real-time...", "wait");

          const responseStream = await ai.models.generateContentStream({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { fileData: { fileUri: processed.uri, mimeType: processed.mimeType } },
                  {
                    text:
                      "Transcribe the audio of this video in its original spoken language keeping maximum fidelity to the spoken content.\n\n" +
                      "Guidelines:\n" +
                      "1. Add timestamps at the beginning of each sentence in [MM:SS] or [HH:MM:SS] format.\n" +
                      "2. Identify speakers if multiple people speak.\n" +
                      "3. Preserve original words, slang, or technical terms.\n" +
                      "4. Return ONLY the transcription with timestamps.",
                  },
                ],
              },
            ],
          });

          for await (const chunk of responseStream) {
            const chunkText = chunk.text ?? "";
            if (chunkText && isSubscribed) {
              resultText += chunkText;
              setStreamContent((prev) => prev + chunkText);
            }
          }

          // Cleanup Gemini remote file
          try {
            await deleteRemoteFile(ai, uploaded.name);
            addLog("Remote file deleted from Gemini", "ok");
          } catch {
            // Non-fatal
          }
        } else {
          // Whisper
          setActiveStage(2);
          if (!(await checkWhisperCli())) {
            throw new Error("whisper-cli not found. Install with: brew install whisper-cpp");
          }

          if (!(await modelExists(model))) {
            addLog(`Downloading model ${model}...`, "wait");
            await downloadModel(model, (dl: number, total: number) => {
              if (total > 0 && isSubscribed) {
                const pct = Math.round((dl / total) * 100);
                updateLastLog(`Downloading model ${model}... ${pct}% (${dl.toFixed(0)}/${total.toFixed(0)} MB)`, "wait");
              }
            });
            addLog(`Model ${model} downloaded`, "ok");
          }

          setActiveStage(3);
          addLog("Transcribing locally with Whisper...", "wait");
          const whisperRes = await transcribeWithWhisper(audioFilePath, tempDir, model, language);
          resultText = whisperRes.srt ? srtToTimestampedText(whisperRes.srt) : whisperRes.text;
          setStreamContent(resultText);
          addLog("Local transcription completed", "ok");
        }

        // 4. Save output
        setActiveStage(4);
        const fileName = `${slugifyFilename(audio.title)}.txt`;
        const outFilePath = join(outDirResolved, fileName);
        await writeFile(outFilePath, resultText, "utf8");
        addLog(`Saved to: ${hyperlink(outFilePath, pathToFileURL(outFilePath).href)}`, "ok");

        // 5. Clean up local files
        setActiveStage(5);
        if (audioWasReused) {
          // Audio was reused from output dir -- do NOT delete it
          addLog("Audio file preserved in output folder", "ok");
        } else if (keepAudio && audioFilePath) {
          const ext = extname(audioFilePath);
          const dest = join(outDirResolved, `${slugifyFilename(audio.title)}${ext}`);
          if (resolve(audioFilePath) !== resolve(dest)) {
            await rename(audioFilePath, dest);
          }
          addLog(`Audio file saved at: ${dest}`, "ok");
        } else if (audioFilePath) {
          await rm(audioFilePath, { force: true });
          addLog("Temporary audio deleted", "ok");
        }

        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true });
        }
        addLog("Cleanup complete", "ok");

        if (isSubscribed) {
          setCompletedInfo({
            title: audio.title,
            url,
            outputPath: outFilePath,
            size: formatFileSize(stats.size),
            engine: engine ?? "gemini",
            reused: audioWasReused,
          });
        }
      } catch (err) {
        if (isSubscribed) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMessage(msg);
        }
      }
    };

    runProcess();

    return () => {
      isSubscribed = false;
    };
  }, [step]);

  // Auto-exit after completion or error (short delay to render final state)
  useEffect(() => {
    if (completedInfo || errorMessage) {
      const timer = setTimeout(() => exit(), 500);
      return () => clearTimeout(timer);
    }
  }, [completedInfo, errorMessage, exit]);

  // Option lists
  const engineItems: SelectItem[] = [
    { label: "Gemini (cloud)", value: "gemini", description: "Fast cloud transcription with speaker diarization and timestamps" },
    { label: "Whisper (local)", value: "whisper", description: "100% offline, private transcription on Apple Silicon GPU" },
  ];

  const whisperModelItems: SelectItem[] = WHISPER_MODELS.map((m) => ({
    label: `${m.label} (${m.size}) - ${m.description}`,
    value: m.id,
  }));

  const langItems: SelectItem[] = [
    { label: "Auto-detect", value: "auto" },
    { label: "Portuguese", value: "pt" },
    { label: "English", value: "en" },
    { label: "Spanish", value: "es" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Italian", value: "it" },
    { label: "Japanese", value: "ja" },
  ];

  const confirmItems: SelectItem[] = [
    { label: "No (delete audio after processing)", value: "no" },
    { label: "Yes (save audio to output folder)", value: "yes" },
  ];

  const statusPrefix = (status: "ok" | "info" | "wait") => {
    switch (status) {
      case "ok": return "[OK]";
      case "wait": return "[..]";
      default: return "[--]";
    }
  };

  const statusColor = (status: "ok" | "info" | "wait") => {
    switch (status) {
      case "ok": return "green";
      case "wait": return "yellow";
      default: return "white";
    }
  };

  return (
    <Box flexDirection="column" padding={1} width={contentWidth}>
      {/* ASCII Art Logo */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red">{LOGO}</Text>
        <Text> </Text>
        <Text color="gray" dimColor>
          {" "}
          v1.0 -- Video transcription powered by AI
        </Text>
      </Box>

      {/* Error Message Display */}
      {errorMessage && (
        <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} width="100%">
          <Text color="red" bold>
            [ERROR] {errorMessage}
          </Text>
        </Box>
      )}

      {/* Step 1: URL */}
      {step === "url" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Enter or paste the YouTube link:
          </Text>
          <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1} width="100%">
            <TextInput value={url} onChange={setUrl} onSubmit={handleUrlSubmit} />
          </Box>
        </Box>
      )}

      {/* Step 2: Engine */}
      {step === "engine" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Select transcription engine:
          </Text>
          <SelectInput items={engineItems} onSelect={handleEngineSelect} />
        </Box>
      )}

      {/* Step 3: Whisper Model */}
      {step === "whisper_model" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Select Whisper model:
          </Text>
          <SelectInput items={whisperModelItems} onSelect={handleWhisperModelSelect} />
        </Box>
      )}

      {/* Step 4: Whisper Language */}
      {step === "whisper_lang" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Select audio language:
          </Text>
          <SelectInput items={langItems} onSelect={handleWhisperLangSelect} />
        </Box>
      )}

      {/* Step 5: Keep Audio */}
      {step === "keep_audio" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Keep downloaded audio file?
          </Text>
          <SelectInput items={confirmItems} onSelect={handleKeepAudioSelect} />
        </Box>
      )}

      {/* Step 6: Confirm Model Download */}
      {step === "download_confirm" && isInteractive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            Whisper model "{model}" not found locally. Download now?
          </Text>
          <SelectInput
            items={[
              { label: "Yes, download model", value: "yes" },
              { label: "No, cancel operation", value: "no" },
            ]}
            onSelect={handleDownloadConfirmSelect}
          />
        </Box>
      )}

      {/* Step 7: Processing Dashboard */}
      {step === "processing" && (
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="cyan">
              Processing Stages:
            </Text>
            {stageLogs.map((log, index) => (
              <Text key={index} color={statusColor(log.status)}>
                {statusPrefix(log.status)} {log.text}
              </Text>
            ))}
            {!completedInfo && !errorMessage && (
              <Box marginTop={1}>
                <Text color="yellow">
                  <Spinner type="dots" /> Stage {activeStage}/5 in progress...
                </Text>
              </Box>
            )}
          </Box>

          {/* Completion Summary */}
          {completedInfo && (
            <Box
              borderStyle="round"
              borderColor="green"
              flexDirection="column"
              paddingX={2}
              paddingY={1}
              marginBottom={1}
              width="100%"
            >
              <Text bold color="green">
                [DONE] Transcription successfully completed!
              </Text>
              <Text>
                <Text bold>Video Title: </Text>
                {completedInfo.title}
              </Text>
              <Text>
                <Text bold>YouTube URL: </Text>
                <Text color="cyan" underline>
                  {hyperlink(completedInfo.url, completedInfo.url)}
                </Text>
              </Text>
              <Text bold>Saved File:</Text>
              <Text color="cyan" underline>
                {hyperlink(completedInfo.outputPath, pathToFileURL(completedInfo.outputPath).href)}
              </Text>
              <Text>
                <Text bold>Engine: </Text>
                {completedInfo.engine}
              </Text>
              {completedInfo.reused && (
                <Text color="yellow">
                  <Text bold>Audio: </Text>
                  Reused existing file (no re-download needed)
                </Text>
              )}
            </Box>
          )}

          {/* Live Streaming Content Box */}
          {streamContent.length > 0 && (
            <Box
              borderStyle="single"
              borderColor="gray"
              flexDirection="column"
              padding={1}
              marginBottom={1}
              width="100%"
            >
              <Text bold color="gray">
                --- Transcription Preview ---
              </Text>
              <Text color="white">
                {streamContent.slice(-500)}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
