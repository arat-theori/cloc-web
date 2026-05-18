"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "@/lib/cloc";
import { entriesFromDataTransfer } from "@/lib/archives/dir";

type Source =
  | { kind: "archive"; file: File }
  | { kind: "directory"; entries: FileEntry[]; rootName: string };

type Props = {
  onSource: (source: Source) => void;
  disabled?: boolean;
};

type WithPicker = Window & {
  showDirectoryPicker?: (opts?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
};

export function DropZone({ onSource, disabled }: Props) {
  const [over, setOver] = useState(false);
  const [folderPickerStatus, setFolderPickerStatus] = useState<"checking" | "available" | "blocked">("checking");
  const [folderError, setFolderError] = useState<string | null>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  // Decide once whether the modern picker even exists. We don't surface a
  // "Browse folder" button unless it does — the legacy <input webkitdirectory>
  // path silently truncates large trees, which would hand back wrong totals
  // with no warning. Drag-and-drop is the safe alternative for those users.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as WithPicker;
    setFolderPickerStatus(typeof w.showDirectoryPicker === "function" ? "available" : "blocked");
  }, []);

  const handleArchiveInput = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onSource({ kind: "archive", file: files[0] });
    },
    [onSource],
  );

  const handleBrowseFolder = useCallback(() => {
    if (disabled) return;
    setFolderError(null);
    const w = window as unknown as WithPicker;
    if (typeof w.showDirectoryPicker !== "function") {
      setFolderPickerStatus("blocked");
      return;
    }
    // Call synchronously from the click handler so Chrome's user-activation
    // token is still valid. Handle the resolution via .then().
    w.showDirectoryPicker({ mode: "read" }).then(
      async (handle) => {
        const { entriesFromDirectoryHandle } = await import("@/lib/archives/dir");
        const entries = await entriesFromDirectoryHandle(handle);
        onSource({ kind: "directory", entries, rootName: handle.name });
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // The browser refused: extension/policy/sandbox. Surface a clear
        // message and direct the user to drag-and-drop instead.
        setFolderPickerStatus("blocked");
        setFolderError(
          err instanceof Error ? err.message : "Folder picker is not available in this browser.",
        );
      },
    );
  }, [disabled, onSource]);

  const handleDrop = useCallback(
    async (dt: DataTransfer) => {
      const picked = await entriesFromDataTransfer(dt);
      if (!picked) return;
      // Single file + recognized archive extension → treat as archive (uses
      // the zip/tar streaming path). Anything else (multiple files, or a
      // single non-archive file, or a directory) goes through the per-file
      // reader path.
      if (
        picked.entries.length === 1 &&
        /\.(zip|tar|tar\.gz|tgz)$/i.test(picked.entries[0].path) &&
        dt.files.length === 1
      ) {
        onSource({ kind: "archive", file: dt.files[0] });
        return;
      }
      onSource({ kind: "directory", entries: picked.entries, rootName: picked.rootName });
    },
    [onSource],
  );

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        void handleDrop(e.dataTransfer);
      }}
      className={[
        "group relative rounded-lg border border-dashed p-8 transition-colors",
        over ? "border-accent bg-accent/5" : "border-border hover:border-neutral-500",
        disabled ? "pointer-events-none opacity-50" : "",
      ].join(" ")}
    >
      <input
        ref={archiveInputRef}
        type="file"
        accept=".zip,.tar,.tar.gz,.tgz,application/zip,application/x-tar,application/gzip"
        className="hidden"
        onChange={(e) => handleArchiveInput(e.target.files)}
      />
      <div className="flex flex-col items-center gap-3 text-center">
        <UploadIcon className="h-8 w-8 text-neutral-400 group-hover:text-neutral-200" />
        <div className="text-sm text-neutral-300">
          <span className="font-medium text-neutral-100">Drop an archive or folder</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !disabled && archiveInputRef.current?.click()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
          >
            Browse archive…
          </button>
          {folderPickerStatus === "available" ? (
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
            >
              Browse folder…
            </button>
          ) : null}
        </div>
        <div className="text-xs text-neutral-500">
          .zip · .tar · .tar.gz · .tgz · or any directory
        </div>
        {folderError ? (
          <div className="text-xs text-yellow-400">
            Folder picker blocked by your browser ({folderError}). Drag the
            folder onto this box instead.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 7.5L12 3m0 0L7.5 7.5M12 3v13.5" />
    </svg>
  );
}
