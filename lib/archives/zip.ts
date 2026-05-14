import JSZip from "jszip";
import type { FileEntry } from "../cloc";
import { looksBinary } from "./binary";

export async function extractZip(buffer: ArrayBuffer): Promise<FileEntry[]> {
  const zip = await JSZip.loadAsync(buffer);
  const entries: FileEntry[] = [];
  zip.forEach((_relativePath, entry) => {
    if (entry.dir) return;
    entries.push({
      path: entry.name,
      size: undefined,
      read: async () => {
        try {
          // Read as Uint8Array so we can detect binary before decoding.
          const bytes = await entry.async("uint8array");
          if (looksBinary(bytes)) return null;
          return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        } catch {
          return null;
        }
      },
    });
  });
  return entries;
}
