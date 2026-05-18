"use client";

import { useCallback, useRef, useState } from "react";
import type { FileEntry } from "@/lib/cloc";
import { entriesFromDataTransfer, entriesFromFileList } from "@/lib/archives/dir";

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

  // Modern File System Access API picker. Must be called *synchronously*
  // from the click handler so Chrome sees the user-activation token —
  // wrapping it in an async function + `await` chain occasionally drops
  // the activation and the API throws NotAllowedError. Returns true if
  // we invoked the modern picker (regardless of outcome); false if it's
  // unavailable.
  const tryModernPicker = useCallback((): boolean => {
    type WithPicker = Window & {
      showDirectoryPicker?: (opts?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
    };
    const w = window as unknown as WithPicker;
    if (typeof w.showDirectoryPicker !== "function") return false;
    w.showDirectoryPicker({ mode: "read" }).then(
      async (handle) => {
        const { entriesFromDirectoryHandle } = await import("@/lib/archives/dir");
        const entries = await entriesFromDirectoryHandle(handle);
        // eslint-disable-next-line no-console
        console.info(`[cloc-web] showDirectoryPicker enumerated ${entries.length} files`);
        onSource({ kind: "directory", entries, rootName: handle.name });
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          // eslint-disable-next-line no-console
          console.info("[cloc-web] folder pick: user dismissed showDirectoryPicker");
          return;
        }
        // eslint-disable-next-line no-console
        console.warn("[cloc-web] folder pick: showDirectoryPicker rejected, falling back to webkitdirectory", err);
        folderInputRef.current?.click();
      },
    );
    return true;
  }, [onSource]);

  const handleBrowseFolder = useCallback(() => {
    if (disabled) return;
    if (tryModernPicker()) return;
    // No modern API — use legacy webkitdirectory.
    folderInputRef.current?.click();
  }, [disabled, tryModernPicker]);

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
            onClick={handleBrowseFolder}
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
