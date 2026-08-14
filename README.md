<p align="center">
  <img src="./assets/logo.png" alt="yt-transcriber" width="220" />
</p>

<!--<h1 align="center">yt-transcriber</h1>-->

<p align="center">
  <strong>Any YouTube video, turned into text, in minutes.</strong><br />
  Automatic timestamps, speaker identification, straight from your terminal.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20" />
  <img src="https://img.shields.io/badge/TypeScript-5%2B-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/UI-Ink%20TUI-8A2BE2" alt="Ink TUI" />
  <img src="https://img.shields.io/badge/engines-Gemini%20%7C%20Whisper-orange" alt="Gemini or Whisper" />
</p>

## What it is

**yt-transcriber** is an interactive CLI that turns any YouTube video into a clean, organized transcript — complete with timestamps, corrected punctuation, and speaker identification — without ever leaving your terminal.

Paste a link, pick a transcription engine, and you're done: the audio is extracted, processed, and saved as a `.txt` file in your output folder. No third-party web services, no copy-pasting into online tools.

## Why use it

- **Two engines, one interface.** Use **Gemini** (cloud, real-time streaming, great for most cases) or **Whisper.cpp** (100% local, your audio never leaves your machine).
- **Timestamps and diarization, built in.** Every transcript comes with `[MM:SS]` markers and speaker identification whenever more than one person is talking.
- **A real TUI, not just a spinner.** An Ink-powered interface shows every stage of the process — download, upload, transcription — in real time.
- **Zero setup friction.** The `yt-dlp` binary is downloaded automatically on install; no need to install Python or configure anything separately.
- **Works with or without flags.** Run `./yt-transcriber` and answer the prompts, or pass everything via the command line for use in scripts.

## The two engines

| | **Gemini** | **Whisper** |
|---|---|---|
| Runs on | Cloud (`@google/genai`) | 100% local (`whisper-cli`) |
| Requires | `GEMINI_API_KEY` | Model downloaded to `~/.cache/whisper.cpp/` |
| Output | Text arrives in real-time streaming | Processed in batch |
| Best for | Speed and quality without installing anything heavy | Privacy, offline use, no API cost |

## Installation

```bash
git clone git@github.com:jotafurtado/yt-transcriber.git
cd yt-transcriber
npm install        # also downloads the yt-dlp binary automatically
npm run build
```

Set your Gemini API key (only needed if you plan to use that engine):

```bash
echo "GEMINI_API_KEY=your_api_key_here" > .env
```

If you want to use Whisper, install `whisper-cli`:

```bash
brew install whisper-cpp
```

The CLI automatically checks whether the Whisper model exists and offers to download it if it's missing.

## Usage

### Interactive mode (recommended)

```bash
./yt-transcriber
```

The CLI asks for the video link, lets you pick the engine, configure options, and follow the progress in real time, stage by stage.

### Direct mode

```bash
./yt-transcriber "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Fully non-interactive (great for scripts)

```bash
# Gemini
./yt-transcriber --engine gemini "https://www.youtube.com/watch?v=VIDEO_ID"

# Whisper
./yt-transcriber --engine whisper --model large-v3-turbo-q5_0 --language en "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Options

```text
  -e, --engine <gemini|whisper>   Transcription engine
  -m, --model <model>             Model (Gemini: gemini-3.5-flash | Whisper: large-v3-turbo-q5_0)
  -l, --language <lang>           Audio language for Whisper (auto, pt, en, es, ...)
  -o, --output-dir <dir>          Output directory (default: output)
      --keep-audio                Keep the downloaded audio file
  -h, --help                      Show this help message
```

Any option passed as a flag skips the corresponding interactive prompt, so you can freely mix flags and prompts.

## How it works under the hood

```
[YouTube Link]
       │
       ▼
 1. Audio extraction (yt-dlp)          ──► Temporary M4A/WebM file
       │
       ▼
 2. Upload / local processing          ──► Gemini Files API or WAV conversion (Whisper)
       │
       ▼
 3. Intelligent transcription          ──► Gemini 3.5 Flash or Whisper.cpp, with timestamps and speakers
       │
       ▼
 4. Finalization                       ──► Saved to output/, temporary files cleaned up
```

More technical architecture details are in [`AGENTS.md`](./AGENTS.md).

## Requirements

- Node.js 20+
- `ffmpeg` on the PATH (only needed for the Whisper engine)
- `whisper-cli` via `brew install whisper-cpp` (only needed for the Whisper engine)

## Credits

Built on top of [yt-dlp](https://github.com/yt-dlp/yt-dlp), [whisper.cpp](https://github.com/ggerganov/whisper.cpp), the [Gemini API](https://ai.google.dev/), and [Ink](https://github.com/vadimdemedes/ink).
