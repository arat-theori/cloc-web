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
  // Diagnostic: surface what the browser actually enumerated so a silently
  // truncated FileList shows up immediately. Chrome's <input webkitdirectory>
  // can drop files in very large trees with no error.
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.info(`[cloc-web] picker enumerated ${out.length} files`);
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

  // Start with parentPath = "" so the root contributes its name once.
  // Without this we'd produce "<root>/<root>/<child>/..." paths.
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

  await visit(rootEntry, "");
  return out;
}

/**
 * Walk a `FileSystemDirectoryHandle` (from `showDirectoryPicker()`). This is
 * the modern File System Access API path — Chromium-only today but far
 * more reliable than `<input webkitdirectory>` on large trees, which
 * Chrome can silently truncate. Same lazy contract: each FileEntry only
 * fetches its underlying File when `read()` is called.
 */
export async function entriesFromDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle,
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];

  async function visit(
    handle: FileSystemDirectoryHandle,
    parentPath: string,
  ): Promise<void> {
    const here = parentPath ? `${parentPath}/${handle.name}` : handle.name;
    // `values()` yields all children of the directory without the
    // batched-reader quirks that bite webkitGetAsEntry on big trees.
    // Drain the iterator into a list before recursing — same caution as
    // the legacy walker, in case the handle's iterator has any internal
    // state that the API doesn't promise to keep stable across awaits.
    // TS DOM lib doesn't declare values() yet, but it's standard.
    type IterableHandle = FileSystemDirectoryHandle & {
      values: () => AsyncIterableIterator<FileSystemHandle>;
    };
    const children: FileSystemHandle[] = [];
    for await (const child of (handle as IterableHandle).values()) {
      children.push(child);
    }
    for (const child of children) {
      if (child.kind === "file") {
        const fileHandle = child as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        out.push(fileToEntry(file, `${here}/${child.name}`));
      } else if (child.kind === "directory") {
        await visit(child as FileSystemDirectoryHandle, here);
      }
    }
  }

  await visit(rootHandle, "");
  return out;
}

/**
 * Open the modern directory picker if the browser supports it. Returns
 * `null` if the API is unavailable (then callers fall back to the
 * `<input webkitdirectory>` flow). Throws `AbortError` if the user
 * dismisses the picker — caller decides whether to surface that.
 */
export async function pickDirectory(): Promise<
  { entries: FileEntry[]; rootName: string } | null
> {
  type WithPicker = Window & {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
  };
  const w = (typeof window !== "undefined" ? window : null) as WithPicker | null;
  if (!w?.showDirectoryPicker) return null;
  const handle = await w.showDirectoryPicker({ mode: "read" });
  const entries = await entriesFromDirectoryHandle(handle);
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.info(`[cloc-web] showDirectoryPicker enumerated ${entries.length} files`);
  }
  return { entries, rootName: handle.name };
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
