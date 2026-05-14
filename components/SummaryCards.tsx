"use client";

import type { ClocResult } from "@/lib/cloc";

type Props = {
  result: ClocResult;
  source: string;
};

export function SummaryCards({ result, source }: Props) {
  const { code, comment, blank } = result.total.counts;
  const filesAnalyzed = result.total.files;
  const totalLines = code + comment + blank;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card label="Source" value={source} mono />
      <Card label="Files analyzed" value={filesAnalyzed.toLocaleString()} />
      <Card label="Lines of code" value={code.toLocaleString()} accent />
      <Card label="Comments / Blank" value={`${comment.toLocaleString()} / ${blank.toLocaleString()}`} />
      <Card label="Total lines" value={totalLines.toLocaleString()} />
      <Card label="Languages" value={result.byLanguage.length.toLocaleString()} />
      <Card label="Skipped: binary" value={result.skipped.binary.toLocaleString()} muted />
      <Card label="Skipped: duplicate" value={result.skipped.duplicate.toLocaleString()} muted />
    </div>
  );
}

function Card({
  label,
  value,
  accent,
  muted,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        className={[
          "mt-1 truncate text-lg font-medium tabular-nums",
          accent ? "text-accent" : muted ? "text-neutral-500" : "text-neutral-100",
          mono ? "text-sm" : "",
        ].join(" ")}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
