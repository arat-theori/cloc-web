import type { FileEntry } from "../cloc";
import { extractZip } from "./zip";
import { extractTar, isGzip } from "./tar";

export type ArchiveKind = "zip" | "tar" | "tar.gz";

export function detectKind(fileName: string, bytes: Uint8Array): ArchiveKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".tar")) return "tar";
  // Fallback to magic bytes.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  if (isGzip(bytes)) return "tar.gz";
  // Heuristic for plain tar: USTAR magic at offset 257.
  if (bytes.length >= 263) {
    const m = String.fromCharCode(bytes[257], bytes[258], bytes[259], bytes[260], bytes[261]);
    if (m === "ustar") return "tar";
  }
  return null;
}

export async function extractArchive(fileName: string, buffer: ArrayBuffer): Promise<FileEntry[]> {
  const bytes = new Uint8Array(buffer);
  const kind = detectKind(fileName, bytes);
  if (!kind) throw new Error("Unsupported archive format. Use .zip, .tar, .tar.gz, or .tgz.");
  if (kind === "zip") return extractZip(buffer);
  if (kind === "tar.gz") return extractTar(buffer, { gzip: true });
  return extractTar(buffer);
}
