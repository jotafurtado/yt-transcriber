import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export function sanitizeFilename(name: string): string {
  const sanitizedName = name.replace(/[\\/*?:"<>|]/g, "").trim();
  return sanitizedName || "Untitled Video";
}

/** Lowercase kebab-case basename (no extension) for clickable terminal paths. */
export function slugifyFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "untitled-video";
}

export function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
