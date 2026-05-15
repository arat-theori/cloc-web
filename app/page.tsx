"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/DropZone";
import { UrlInput } from "@/components/UrlInput";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultsTable } from "@/components/ResultsTable";
import { StackedBar } from "@/components/StackedBar";
import { SummaryCards } from "@/components/SummaryCards";
import { extractArchive } from "@/lib/archives";
import { clocFiles, type ClocResult, type FileEntry } from "@/lib/cloc";
import { listGitHubFiles, parseGitHubUrl } from "@/lib/github";

type Phase =
  | { kind: "idle" }
  | { kind: "extracting"; label: string }
  | { kind: "listing"; label: string }
  | { kind: "counting"; processed: number; total: number; currentPath?: string }
  | { kind: "done"; result: ClocResult; source: string; warning?: string }
  | { kind: "error"; message: string };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase.kind === "extracting" || phase.kind === "listing" || phase.kind === "counting";

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  }, []);

  const runOnEntries = useCallback(async (entries: FileEntry[], source: string, concurrency: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "counting", processed: 0, total: entries.length });
    const result = await clocFiles(entries, {
      signal: controller.signal,
      concurrency,
      onProgress: (p) =>
        setPhase({ kind: "counting", processed: p.processed, total: p.total, currentPath: p.currentPath }),
    });
    setPhase({ kind: "done", result, source });
  }, []);

  const runOnSource = useCallback(
    async (src:
      | { kind: "archive"; file: File }
      | { kind: "directory"; entries: FileEntry[]; rootName: string }) => {
      try {
        if (src.kind === "archive") {
          setPhase({ kind: "extracting", label: `Reading ${src.file.name}` });
          // Browsers cap a single ArrayBuffer well under typical archive
          // sizes (Chrome 64-bit refuses around 2 GiB). Catch obviously-huge
          // uploads here so we can suggest the directory picker instead of
          // letting `arrayBuffer()` fail with a confusing NotReadableError.
          if (src.file.size > 1.5 * 1024 * 1024 * 1024) {
            throw new Error(
              `Archive is ${formatBytes(src.file.size)} — too large to load into a browser ArrayBuffer. ` +
                `Unpack it and drop the folder instead, or use the GitHub URL input.`,
            );
          }
          const buffer = await src.file.arrayBuffer();
          const entries = await extractArchive(src.file.name, buffer);
          await runOnEntries(entries, src.file.name, 8);
        } else {
          // Per-file reads scale with file count, not total bytes, so a
          // higher concurrency is safe.
          await runOnEntries(src.entries, src.rootName, 16);
        }
      } catch (err) {
        setPhase({ kind: "error", message: errorMessage(err) });
      }
    },
    [runOnEntries],
  );

  const runOnUrl = useCallback(async (url: string) => {
    try {
      const repo = parseGitHubUrl(url);
      if (!repo) {
        setPhase({
          kind: "error",
          message: "Not a valid GitHub URL. Use https://github.com/owner/repo or owner/repo.",
        });
        return;
      }
      setPhase({ kind: "listing", label: `Listing ${repo.owner}/${repo.repo}` });
      const { files, ref, truncated } = await listGitHubFiles(repo);
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: "counting", processed: 0, total: files.length });
      const result = await clocFiles(files, {
        signal: controller.signal,
        concurrency: 16,
        onProgress: (p) =>
          setPhase({ kind: "counting", processed: p.processed, total: p.total, currentPath: p.currentPath }),
      });
      setPhase({
        kind: "done",
        result,
        source: `${repo.owner}/${repo.repo}@${ref}`,
        warning: truncated ? "Repository tree was truncated by GitHub. Some files may be missing." : undefined,
      });
    } catch (err) {
      setPhase({ kind: "error", message: errorMessage(err) });
    }
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-medium tracking-tight text-neutral-100">cloc<span className="text-accent">.web</span></h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Count lines of code by language, in your browser. Drop a <span className="text-neutral-200">.zip / .tar.gz</span> archive
          or paste a GitHub URL. Your code never leaves this tab.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Inspired by{" "}
          <a className="text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline" href="https://github.com/AlDanial/cloc" target="_blank" rel="noreferrer">
            AlDanial/cloc
          </a>
          .
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Upload archive</div>
          <DropZone onSource={runOnSource} disabled={busy} />
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-500">GitHub repository</div>
          <UrlInput onSubmit={runOnUrl} disabled={busy} />
          <p className="text-xs text-neutral-500">
            Uses GitHub&apos;s public API (60 requests/hour, unauthenticated). File contents come from raw.githubusercontent.com.
          </p>
        </div>
      </section>

      <section className="mt-8 space-y-4">
        {phase.kind === "extracting" || phase.kind === "listing" ? (
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-3 text-sm text-neutral-300">
              <Spinner /> {phase.label}…
            </div>
          </div>
        ) : null}

        {phase.kind === "counting" ? (
          <ProgressBar
            label="Counting lines"
            processed={phase.processed}
            total={phase.total}
            detail={phase.currentPath}
          />
        ) : null}

        {phase.kind === "error" ? (
          <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
            {phase.message}
            <button onClick={reset} className="ml-3 text-xs text-red-200 underline">
              Dismiss
            </button>
          </div>
        ) : null}

        {phase.kind === "done" ? (
          <div className="space-y-4">
            {phase.warning ? (
              <div className="rounded-lg border border-yellow-900/60 bg-yellow-950/20 px-4 py-2 text-xs text-yellow-300">
                {phase.warning}
              </div>
            ) : null}
            <SummaryCards result={phase.result} source={phase.source} />
            <StackedBar result={phase.result} />
            <ResultsTable result={phase.result} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => downloadJSON(phase.result, phase.source)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
              >
                Download JSON
              </button>
              <button
                onClick={() => downloadCSV(phase.result, phase.source)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
              >
                Download CSV
              </button>
              <button
                onClick={reset}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <footer className="mt-16 text-xs text-neutral-600">
        <p>Built with Next.js. Open source friendly — runs fully client-side.</p>
      </footer>
    </main>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-600 border-t-accent" />
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9._@-]+/g, "_");
}

function downloadJSON(result: ClocResult, source: string) {
  const payload = {
    source,
    generatedAt: new Date().toISOString(),
    total: result.total,
    byLanguage: result.byLanguage,
    skipped: result.skipped,
  };
  download(`cloc-${safeName(source)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
}

function downloadCSV(result: ClocResult, source: string) {
  const header = "language,files,blank,comment,code";
  const lines = result.byLanguage.map(
    (l) => `${csvField(l.language)},${l.files},${l.counts.blank},${l.counts.comment},${l.counts.code}`,
  );
  lines.push(`Total,${result.total.files},${result.total.counts.blank},${result.total.counts.comment},${result.total.counts.code}`);
  const body = [header, ...lines].join("\n");
  download(`cloc-${safeName(source)}.csv`, new Blob([body], { type: "text/csv" }));
}

function csvField(s: string) {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
