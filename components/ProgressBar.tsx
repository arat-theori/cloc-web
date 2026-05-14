"use client";

type Props = {
  label: string;
  processed: number;
  total: number;
  detail?: string;
};

export function ProgressBar({ label, processed, total, detail }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
        <span>{label}</span>
        <span>
          {processed.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-accent transition-[width] duration-100 ease-linear"
          style={{ width: pct + "%" }}
        />
      </div>
      {detail ? (
        <div className="mt-2 truncate text-xs text-neutral-500" title={detail}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}
