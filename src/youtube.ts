import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import "dotenv/config";
import { sanitizeFilename, slugifyFilename } from "./utils.js";

const executeFile = promisify(execFile);
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultBinaryPath = join(
  projectDirectory,
  ".bin",
  process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp",
);

// Browser used to load YouTube session cookies and bypass the
// "Sign in to confirm you're not a bot" block (yt-dlp --cookies-from-browser).
// Override with YT_DLP_COOKIES_BROWSER, or set it to empty to disable.
const defaultCookiesBrowser = "edge";

const AUDIO_EXTENSIONS = [".m4a", ".webm", ".mp3", ".wav", ".ogg", ".aac", ".flac", ".mp4"];

export interface DownloadedAudio {
  title: string;
  filePath: string;
  reused?: boolean;
}

function getVideoTitle(metadataJson: string): string {
  const metadata: unknown = JSON.parse(metadataJson);
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "title" in metadata &&
    typeof metadata.title === "string"
  ) {
    return metadata.title;
  }

  return "Untitled Video";
}

async function runYtDlp(argumentsList: string[]): Promise<string> {
  const binaryPath = process.env.YT_DLP_BINARY_PATH ?? defaultBinaryPath;
  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_BROWSER ?? defaultCookiesBrowser;
  // Pass browser cookies to yt-dlp to bypass YouTube's "Sign in to confirm
  // you're not a bot" block. Disabled when YT_DLP_COOKIES_BROWSER is empty.
  const cookieArguments = cookiesFromBrowser
    ? ["--cookies-from-browser", cookiesFromBrowser]
    : [];
  // yt-dlp 2026.07+ needs a JS runtime to solve YouTube's n-challenge.
  // Node is already required by this CLI, so reuse it.
  const jsRuntimeArguments = ["--js-runtimes", "node"];
  const { stdout } = await executeFile(
    binaryPath,
    [...cookieArguments, ...jsRuntimeArguments, ...argumentsList],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

async function findDownloadedAudio(downloadDirectory: string, commandOutput: string): Promise<string> {
  const printedPaths = commandOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const printedPath of printedPaths) {
    const candidatePath = isAbsolute(printedPath) ? printedPath : resolve(downloadDirectory, printedPath);
    try {
      await access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  throw new Error("Could not locate the downloaded audio file.");
}

export async function downloadYouTubeAudio(
  url: string,
  downloadDirectory: string,
  existingDir?: string,
): Promise<DownloadedAudio> {
  const metadataOutput = await runYtDlp([
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    url,
  ]);
  const title = getVideoTitle(metadataOutput);
  const titleBases = [
    slugifyFilename(title),
    sanitizeFilename(title),
    // yt-dlp --restrict-filenames style (spaces -> underscores)
    sanitizeFilename(title).replace(/ /g, "_"),
  ].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  // Check if audio file already exists in existingDir (e.g. output folder)
  if (existingDir) {
    for (const base of titleBases) {
      for (const ext of AUDIO_EXTENSIONS) {
        const candidatePath = join(existingDir, `${base}${ext}`);
        try {
          await access(candidatePath);
          return {
            title,
            filePath: candidatePath,
            reused: true,
          };
        } catch {
          continue;
        }
      }
    }
  }

  // If not found locally, download via yt-dlp
  const commandOutput = await runYtDlp([
    "--format",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "--output",
    join(downloadDirectory, "%(title)s.%(ext)s"),
    "--print",
    "after_move:filepath",
    "--restrict-filenames",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    url,
  ]);

  return {
    title,
    filePath: await findDownloadedAudio(downloadDirectory, commandOutput),
    reused: false,
  };
}
