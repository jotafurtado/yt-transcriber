import React from "react";
import { render } from "ink";
import { parseArgs } from "node:util";
import { App } from "./ui/App.js";

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      engine: { type: "string", short: "e" },
      model: { type: "string", short: "m" },
      language: { type: "string", short: "l" },
      "output-dir": { type: "string", short: "o", default: "output" },
      "keep-audio": { type: "boolean" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  return { values, positionals };
}

function printHelp(): void {
  console.log(`Usage: yt-transcriber [URL] [options]

Transcribes the audio of a YouTube video using Ink TUI.

Without arguments, enters interactive TUI mode.

Options:
  -e, --engine <gemini|whisper>   Transcription engine
  -m, --model <model>             Model (Gemini: gemini-3.5-flash | Whisper: large-v3-turbo-q5_0)
  -l, --language <lang>           Audio language for Whisper (auto, pt, en, es, ...)
  -o, --output-dir <dir>          Output directory (default: output)
      --keep-audio                Keep the downloaded audio file
  -h, --help                      Show this help message
`);
}

async function main() {
  const parsed = parseCliArgs();
  if (parsed.values.help) {
    printHelp();
    return;
  }

  const initialUrl = parsed.positionals[0];
  const initialEngine = parsed.values.engine as "gemini" | "whisper" | undefined;
  const initialModel = parsed.values.model as string | undefined;
  const initialLanguage = parsed.values.language as string | undefined;
  const outputDir = (parsed.values["output-dir"] as string | undefined) ?? "output";
  const keepAudioFlag = parsed.values["keep-audio"] as boolean | undefined;

  render(
    React.createElement(App, {
      initialUrl,
      initialEngine,
      initialModel,
      initialLanguage,
      outputDir,
      keepAudioFlag,
    }),
  );
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Error: ${msg}`);
  process.exit(1);
});
