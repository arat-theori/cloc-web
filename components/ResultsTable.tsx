"use client";

import { useMemo, useState } from "react";
import type { ClocResult, LanguageStat } from "@/lib/cloc";
import { languageColor } from "./languageColor";

type SortKey = "language" | "files" | "blank" | "comment" | "code";

type Props = {
  result: ClocResult;
};

export function ResultsTable({ result }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "code", dir: "desc" });

  const rows = useMemo(() => {
    const arr = result.byLanguage.slice();
    arr.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const v = (s: LanguageStat) =>
        sort.key === "language"
          ? (s.language as string | number)
          : sort.key === "files"
            ? s.files
            : sort.key === "blank"
              ? s.counts.blank
              : sort.key === "comment"
                ? s.counts.comment
                : s.counts.code;
      const va = v(a);
      const vb = v(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return arr;
  }, [result.byLanguage, sort]);

  const totalCode = result.total.counts.code || 1;

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "language" ? "asc" : "desc" }));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <Th onClick={() => toggleSort("language")} active={sort.key === "language"} dir={sort.dir} align="left">
                Language
              </Th>
              <Th onClick={() => toggleSort("files")} active={sort.key === "files"} dir={sort.dir} align="right">
                Files
              </Th>
              <Th onClick={() => toggleSort("blank")} active={sort.key === "blank"} dir={sort.dir} align="right">
                Blank
              </Th>
              <Th onClick={() => toggleSort("comment")} active={sort.key === "comment"} dir={sort.dir} align="right">
                Comment
              </Th>
              <Th onClick={() => toggleSort("code")} active={sort.key === "code"} dir={sort.dir} align="right">
                Code
              </Th>
              <th className="px-3 py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pct = (row.counts.code / totalCode) * 100;
              const color = languageColor(row.language);
              return (
                <tr key={row.language} className="border-t border-border/60 hover:bg-neutral-900/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                      <span className="text-neutral-200">{row.language}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{row.files.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{row.counts.blank.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{row.counts.comment.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-100">{row.counts.code.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="ml-auto flex w-32 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
                        <div className="h-full" style={{ width: pct + "%", background: color }} />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-neutral-400">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-neutral-900/60 text-neutral-200">
            <tr className="border-t border-border">
              <td className="px-3 py-2 font-medium">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{result.total.files.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{result.total.counts.blank.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{result.total.counts.comment.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{result.total.counts.code.toLocaleString()}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
}) {
  return (
    <th className={"select-none px-3 py-2 font-medium " + (align === "right" ? "text-right" : "text-left")}>
      <button onClick={onClick} className={"inline-flex items-center gap-1 hover:text-neutral-200 " + (active ? "text-neutral-200" : "")}>
        {children}
        {active ? <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}
