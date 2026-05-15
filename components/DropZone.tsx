"use client";

import { useCallback, useRef, useState } from "react";
import type { FileEntry } from "@/lib/cloc";
import { entriesFromDataTransfer, entriesFromFileList, pickDirectory } from "@/lib/archives/dir";

type Source =
  | { kind: "archive"; file: File }
  | { kind: "directory"; entries: FileEntry[]; rootName: string };

type Props = {
  onSource: (source: Source) => void;
  disabled?: boolean;
};

export function DropZone({ onSource, disabled }: Props) {
  const [over, setOver] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleArchiveInput = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onSource({ kind: "archive", file: files[0] });
    },
    [onSource],
  );

  const handleFolderInput = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const entries = entriesFromFileList(files);
      // The first segment of webkitRelativePath is the dropped folder name.
      const first = (files[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const rootName = first.split("/")[0] || "directory";
      onSource({ kind: "directory", entries, rootName });
    },
    [onSource],
  );

  const handleBrowseFolder = useCallback(async () => {
    if (disabled) return;
    // Prefer the modern File System Access API — Chrome's legacy
    // <input webkitdirectory> can silently truncate large trees.
    try {
      const picked = await pickDirectory();
      if (picked) {
        onSource({ kind: "directory", entries: picked.entries, rootName: picked.rootName });
        return;
      }
    } catch (e) {
      // User dismissed showDirectoryPicker. Treat as no-op.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Other errors fall through to the legacy input below.
    }
    folderInputRef.current?.click();
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
      <input
        ref={folderInputRef}
        type="file"
        // The non-standard `webkitdirectory` attribute opens a folder picker
        // in Chromium / Firefox / Safari — typing as `any` keeps React happy.
        {...({ webkitdirectory: "" } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => handleFolderInput(e.target.files)}
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
          <button
            type="button"
            onClick={() => void handleBrowseFolder()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
          >
            Browse folder…
          </button>
        </div>
        <div className="text-xs text-neutral-500">
          .zip · .tar · .tar.gz · .tgz · or any directory
        </div>
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
