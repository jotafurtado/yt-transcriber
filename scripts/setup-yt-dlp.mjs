import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryName =
  process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp";
const binaryPath = join(projectDirectory, ".bin", binaryName);

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

async function installYtDlp() {
  if (process.env.YT_DLP_BINARY_PATH) {
    console.log("YT_DLP_BINARY_PATH is set; automatic download skipped.");
    return;
  }

  try {
    await access(binaryPath);
    console.log(`yt-dlp is already available at ${binaryPath}`);
    return;
  } catch {
    // Binary does not exist yet.
  }

  const releaseResponse = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
    headers: { "User-Agent": "yt-transcriber" },
  });
  if (!releaseResponse.ok) {
    throw new Error(`GitHub responded with HTTP ${releaseResponse.status}.`);
  }

  const release = await releaseResponse.json();
  if (!isRecord(release) || !Array.isArray(release.assets)) {
    throw new Error("yt-dlp release response has an unexpected format.");
  }

  const asset = release.assets.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.name === binaryName &&
      typeof candidate.browser_download_url === "string",
  );
  if (!asset || typeof asset.browser_download_url !== "string") {
    throw new Error(`yt-dlp release does not contain asset ${binaryName}.`);
  }

  const binaryResponse = await fetch(asset.browser_download_url);
  if (!binaryResponse.ok) {
    throw new Error(`yt-dlp download failed with HTTP ${binaryResponse.status}.`);
  }

  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, Buffer.from(await binaryResponse.arrayBuffer()));
  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }
  console.log(`yt-dlp installed at ${binaryPath}`);
}

try {
  await installYtDlp();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Could not download yt-dlp during installation: ${message}`);
  console.warn("Run npm run setup:yt-dlp when connected or set YT_DLP_BINARY_PATH.");
}
