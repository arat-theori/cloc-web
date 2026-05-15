import { bytesHash, looksBinary } from "./binary";
import type { FileEntry } from "../cloc";

// Build FileEntry[] from a directory the user picked or dragged in.
// Each entry's `read()` lazy-loads only that one file, so we never put
// the whole tree in memory — this is why directory selection beats
// uploading a 6 GB zip (which would have to fit in a single ArrayBuffer).

function fileToEntry(file: File, path: string): FileEntry {
  return {
    path,
    size: file.size,
    read: async () => {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        if (looksBinary(buf)) return null;
        return {
          content: new TextDecoder("utf-8", { fatal: false }).decode(buf),
          hash: bytesHash(buf),
          byteLength: buf.byteLength,
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Convert a `FileList` from `<input type=file webkitdirectory>` to
 * FileEntry[]. The browser populates `webkitRelativePath` on each File so
 * we can keep the on-disk paths in the report.
 */
export function entriesFromFileList(files: FileList): FileEntry[] {
  const out: FileEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    out.push(fileToEntry(f, rel && rel.length > 0 ? rel : f.name));
  }
  return out;
}

/**
 * Walk a `FileSystemDirectoryEntry` (from `DataTransferItem.webkitGetAsEntry()`
 * on drop) and collect FileEntry[]. Stays lazy: each FileEntry resolves its
 * File only when `read()` is called.
 */
export async function entriesFromDirectoryEntry(
  rootEntry: FileSystemDirectoryEntry,
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const rootPrefix = rootEntry.name;

  async function visit(entry: FileSystemEntry, parentPath: string): Promise<void> {
    const here = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file: File = await new Promise((resolve, reject) =>
        fileEntry.file(resolve, reject),
      );
      out.push(fileToEntry(file, here));
      return;
    }
    if (entry.isDirectory) {
      // Drain the directory reader BEFORE recursing into any child. Chrome's
      // FileSystemDirectoryReader returns batches of up to ~100 entries per
      // readEntries() call and tracks its position internally — if we
      // interleave child-directory walks (each creating their own readers)
      // with parent reads, the parent reader's iteration silently desyncs
      // and whole subtrees go missing (observed on the Linux kernel:
      // include/dt-bindings/ disappeared, ~1.4K headers lost).
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      while (true) {
        const batch: FileSystemEntry[] = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        children.push(...batch);
      }
      for (const child of children) await visit(child, here);
    }
  }

  await visit(rootEntry, rootPrefix);
  return out;
}

/**
 * Best-effort: pull entries out of a DataTransfer drop. Falls back to the
 * flat `files` list if `webkitGetAsEntry` isn't available.
 *
 * Returns `null` when the drop has no items (caller should treat as no-op).
 */
export async function entriesFromDataTransfer(
  dt: DataTransfer,
): Promise<{ entries: FileEntry[]; rootName: string } | null> {
  // Prefer items[] so we can detect directories.
  if (dt.items && dt.items.length > 0) {
    const collected: FileEntry[] = [];
    let rootName = "";
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== "file") continue;
      const getAsEntry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null;
        }
      ).webkitGetAsEntry?.bind(item);
      const entry = getAsEntry ? getAsEntry() : null;
      if (entry && entry.isDirectory) {
        if (!rootName) rootName = entry.name;
        const sub = await entriesFromDirectoryEntry(entry as FileSystemDirectoryEntry);
        collected.push(...sub);
      } else {
        const f = item.getAsFile();
        if (f) {
          if (!rootName) rootName = f.name;
          collected.push(fileToEntry(f, f.name));
        }
      }
    }
    if (collected.length === 0) return null;
    return { entries: collected, rootName };
  }
  // Fallback: plain files list (no directory info).
  if (dt.files && dt.files.length > 0) {
    const entries = entriesFromFileList(dt.files);
    return { entries, rootName: dt.files[0].name };
  }
  return null;
}
