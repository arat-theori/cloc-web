"use client";

import type { ClocResult } from "@/lib/cloc";
import { languageColor } from "./languageColor";

type Props = {
  result: ClocResult;
};

export function StackedBar({ result }: Props) {
  const total = result.total.counts.code || 1;
  // Show top 10 languages by code count, group the rest into "Other".
  const top = result.byLanguage.slice(0, 10);
  const restCode = result.byLanguage.slice(10).reduce((acc, l) => acc + l.counts.code, 0);
  const segments = top.map((l) => ({ name: l.language, code: l.counts.code, color: languageColor(l.language) }));
  if (restCode > 0) segments.push({ name: "Other", code: restCode, color: "#444444" });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Language breakdown</h3>
        <div className="text-xs text-neutral-500">{result.total.counts.code.toLocaleString()} lines of code</div>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-800">
        {segments.map((s) => (
          <div
            key={s.name}
            className="h-full"
            style={{ width: (s.code / total) * 100 + "%", background: s.color }}
            title={`${s.name}: ${s.code.toLocaleString()} (${((s.code / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {segments.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-neutral-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="text-neutral-300">{s.name}</span>
            <span className="tabular-nums">{((s.code / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
