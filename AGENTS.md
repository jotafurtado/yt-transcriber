# AGENTS.md - YouTube Transcription Architecture with Gemini

This document describes the technical architecture and audio processing workflow of the TypeScript YouTube Transcription CLI using Ink TUI, Gemini API, and local Whisper.cpp.

## System Overview

The CLI runs the transcription process in 4 well-defined stages:

```
[YouTube Link]
       │
       ▼
 1. Audio Extraction (yt-dlp) ──► Local temporary M4A/WebM file
       │
       ▼
 2. Media Upload (Gemini Files API) ──► Asynchronous upload for cloud processing
       │
       ▼
 3. Intelligent Transcription (Gemini 3.5 Flash) ──► Prompt with timestamps and diarization
       │
       ▼
 4. Finalization & Saving (Local File) ──► Save to output/ and clean temporary files
```

---

## Prompt Engineering for Gemini

The `gemini-3.5-flash` model receives the uploaded audio file and this structured instruction:

```
Transcribe the audio of this video in its original spoken language keeping maximum fidelity to the spoken content.

Guidelines:
1. Add timestamps at the beginning of each relevant sentence or paragraph in [MM:SS] or [HH:MM:SS] format (e.g., [01:23] or [00:05:12]).
2. Identify speakers whenever there is a conversation or multiple people speaking (e.g., 'Speaker 1:', 'Speaker 2:').
3. Apply proper grammar correction and punctuation to make the text flow well, but preserve original words, slang, or technical terms.
4. Return ONLY the resulting transcription with timestamps and corresponding dialogue, with no introductory or concluding text (e.g., do not write 'Here is the transcription').
```

---

## Detailed Step-by-Step Flow

### 1. Audio Extraction (`yt-dlp`)
* `src/youtube.ts` invokes a standalone `yt-dlp` binary through Node.js `child_process`.
* The setup script downloads the platform-specific binary to `.bin/` during `npm install`; no Python or system `ffmpeg` installation is required.
* The downloader prefers native M4A (AAC) or WebM (Opus) audio and keeps the downloaded file in a temporary directory.
* The video title is obtained from yt-dlp and sanitized before it is used as an output filename.
* Set `YT_DLP_BINARY_PATH` when a different yt-dlp binary should be used.
* YouTube may return the `Sign in to confirm you're not a bot` block. To bypass it, yt-dlp loads session cookies from a browser via `--cookies-from-browser`. The default browser is `edge`; override with `YT_DLP_COOKIES_BROWSER` (e.g. `chrome`, `safari`) or set it to an empty string to disable cookie loading. The browser must have a logged-in YouTube session.

### 2. Media Upload & Polling
* `src/gemini.ts` uses the `@google/genai` SDK and the Gemini Files API for audio larger than the inline payload limit.
* After upload, `ai.files.get` is polled until the file state becomes `ACTIVE`.
* Failed or unexpected processing states stop the transcription with an explicit error.

### 3. Transcription & Generation
* The configured model receives a `createPartFromUri` reference to the processed audio file and the transcription prompt.
* `generateContentStream` yields text chunks that are written to the terminal as they arrive.

### 4. Storage and Cleanup
* The generated transcription is saved under `output/<sanitized_video_title>.txt`.
* The uploaded Gemini file is deleted in a `finally` block inside `transcribeAudio`.
* The local audio file is deleted after the run unless `--keep-audio` is supplied; in that case it is moved to the output directory.
* The temporary directory is removed after every run.

---

## How to Run the CLI

### Setup
1. Install Node.js 20 or newer.
2. Install dependencies and download the yt-dlp binary:
   ```bash
   npm install
   ```
3. Compile the TypeScript sources:
   ```bash
   npm run build
   ```
4. Create or configure your `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

If the automatic yt-dlp download could not run during installation, execute:

```bash
npm run setup:yt-dlp
```

### Execution

Use the `./yt-transcriber` shortcut after compiling:

1. **Interactive Mode (Recommended)**:
   ```bash
   ./yt-transcriber
   ```
   The CLI displays a rounded border banner, prompts for the YouTube link via Ink TUI, lets the user pick an engine (Gemini or Whisper), configure options, and shows real-time progress spinners and step dashboards for each phase.

2. **Direct Mode**:
   ```bash
   ./yt-transcriber "https://www.youtube.com/watch?v=VIDEO_ID"
   ```
   Skips the URL prompt but still shows engine and option menus.

3. **Fully Non-Interactive**:
   ```bash
   # Gemini
   ./yt-transcriber --engine gemini "https://www.youtube.com/watch?v=VIDEO_ID"

   # Whisper
   ./yt-transcriber --engine whisper --model large-v3-turbo-q5_0 --language en "https://www.youtube.com/watch?v=VIDEO_ID"
   ```

All options:

```text
  -e, --engine <gemini|whisper>   Transcription engine
  -m, --model <model>             Model (Gemini: gemini-3.5-flash | Whisper: large-v3-turbo-q5_0)
  -l, --language <lang>           Audio language for Whisper (auto, pt, en, es, ...)
  -o, --output-dir <dir>          Output directory (default: output)
      --keep-audio                Keep the downloaded audio file
  -h, --help                      Show this help message
```

Any option passed as a flag skips the corresponding interactive prompt, so the user can mix flags and prompts freely.

### Engines

| Engine | Source | Dependencies | Streaming |
|---|---|---|---|
| Gemini | Cloud (`@google/genai`) | `GEMINI_API_KEY` | Real-time text stream |
| Whisper | Local (`whisper-cli` / `whisper.cpp`) | Model in `~/.cache/whisper.cpp/` | Batch (no streaming) |

Whisper requires `whisper-cli` (install with `brew install whisper-cpp`) and a model file. The CLI checks for both and shows download instructions if they are missing.
