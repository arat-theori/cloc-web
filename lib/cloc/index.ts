import { loadCloc, type CountResult } from "@/lib/wasm/cloc";

export type LineCounts = { blank: number; comment: number; code: number };

/** Result of reading a file: UTF-8 decoded content, a hash of the RAW
 * bytes, and the raw byte length. Hashing has to happen on bytes (not the
 * lossy UTF-8 decoding) because distinct files in different legacy code
 * pages decode to identical strings of U+FFFD. The byte length is also
 * authoritative — cloc buckets dedup candidates by *byte* size, which can
 * differ from `content.length` for multi-byte UTF-8 files. */
export type ReadFile = { content: string; hash: string; byteLength: number };

export type FileEntry = {
  path: string;
  /** Lazy reader. Returns null if unreadable/binary. */
  read: () => Promise<ReadFile | null>;
  /** Optional pre-known byte size, used for filtering huge files. */
  size?: number;
};

export type FileResult = {
  path: string;
  language: string;
  counts: LineCounts;
};

export type LanguageStat = {
  language: string;
  files: number;
  counts: LineCounts;
};

export type ClocResult = {
  files: FileResult[];
  byLanguage: LanguageStat[];
  total: LanguageStat;
  skipped: { binary: number; ignored: number; tooLarge: number; unknown: number; error: number; duplicate: number; empty: number };
};

// cloc itself has no per-file size limit. Leave the cap off by default so
// the totals match `cloc <dir>`; callers (e.g. the dropzone) can still pass
// `maxFileBytes` to bound browser memory if they want.
const DEFAULT_MAX_FILE_BYTES = Number.POSITIVE_INFINITY;

export type ClocProgress = {
  processed: number;
  total: number;
  currentPath?: string;
};

export type ClocOptions = {
  onProgress?: (p: ClocProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
  maxFileBytes?: number;
  /**
   * If true, skip cloc's default duplicate-file detection (by size + SHA-1).
   * Matches cloc's `--skip-uniqueness` flag.
   */
  skipUniqueness?: boolean;
};

const emptyCounts = (): LineCounts => ({ blank: 0, comment: 0, code: 0 });
const addCounts = (a: LineCounts, b: LineCounts): LineCounts => ({
  blank: a.blank + b.blank,
  comment: a.comment + b.comment,
  code: a.code + b.code,
});


export async function clocFiles(files: FileEntry[], opts: ClocOptions = {}): Promise<ClocResult> {
  const onProgress = opts.onProgress;
  const signal = opts.signal;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const wasm = await loadCloc();

  const results: FileResult[] = [];
  const skipped = { binary: 0, ignored: 0, tooLarge: 0, unknown: 0, error: 0, duplicate: 0, empty: 0 };

  // Phase 1: path-only pre-filter. We defer language detection until after
  // the content is read, because cloc disambiguates extensions like `.ts`
  // (TypeScript vs Qt Linguist), `.m` (MATLAB/Mathematica/Obj-C/MUMPS/
  // Mercury), `.inc`, `.d`, `.fs`, `.jl`, `pom.xml`, etc. by sniffing
  // content. Calling `detect_language(path, null)` here would lock in the
  // hybrid label (e.g. "TypeScript/Qt Linguist"), and the counter has no
  // filter for that label — every non-blank line would land in `code`.
  const candidates: FileEntry[] = [];
  for (const f of files) {
    if (wasm.is_ignored_path(f.path)) {
      skipped.ignored++;
      continue;
    }
    if (typeof f.size === "number" && f.size > maxFileBytes) {
      skipped.tooLarge++;
      continue;
    }
    if (wasm.is_not_code(f.path)) {
      skipped.unknown++;
      continue;
    }
    candidates.push(f);
  }

  const total = candidates.length;
  let processed = 0;

  type Counted = {
    path: string;
    language: string;
    counts: LineCounts;
    size: number;
    hash: string;
  };
  const counted: Counted[] = [];

  let nextIdx = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const i = nextIdx++;
      if (i >= candidates.length) return;
      const file = candidates[i];
      try {
        const result = await file.read();
        if (result === null) {
          skipped.binary++;
        } else if (result.content.length === 0) {
          // cloc skips zero-byte files by default.
          skipped.empty++;
        } else {
          // Detect language using the FULL content so cloc's content-sniff
          // disambiguators (TypeScript/Qt Linguist, Maven/XML, etc.) run.
          const lang = wasm.detect_language_with_content(file.path, result.content) ?? null;
          if (!lang) {
            skipped.unknown++;
          } else {
            const r: CountResult | null = wasm.count_with_language(lang, result.content);
            if (r) {
              counted.push({
                path: file.path,
                language: lang,
                size: result.byteLength,
                hash: result.hash,
                counts: { blank: r.blank, comment: r.comment, code: r.code },
              });
            } else {
              skipped.error++;
            }
          }
        }
      } catch {
        skipped.error++;
      }
      processed++;
      onProgress?.({ processed, total, currentPath: file.path });
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, candidates.length); i++) workers.push(worker());
  await Promise.all(workers);

  // Phase 2: cloc's duplicate-file detection — bucket by size, hash buckets
  // with > 1 entry, keep the alphabetically-first file per (size, hash) group.
  let unique = counted;
  if (!opts.skipUniqueness) {
    const bySize = new Map<number, Counted[]>();
    for (const c of counted) {
      const list = bySize.get(c.size) ?? [];
      list.push(c);
      bySize.set(c.size, list);
    }
    const kept: Counted[] = [];
    for (const list of bySize.values()) {
      if (list.length === 1) {
        kept.push(list[0]);
        continue;
      }
      // Bucket by content hash within the size group. The hash is computed
      // by the FileEntry.read() implementation over RAW BYTES — hashing the
      // UTF-8-decoded string would collapse files with the same byte length
      // but different legacy-codepage encodings (their lossy decodings are
      // identical strings of U+FFFD).
      const byHash = new Map<string, Counted[]>();
      for (const c of list) {
        const sub = byHash.get(c.hash) ?? [];
        sub.push(c);
        byHash.set(c.hash, sub);
      }
      for (const group of byHash.values()) {
        // cloc's different_files() keeps the alphabetically-LAST file that has
        // an identifiable language. We've already filtered to identifiable
        // langs, so the last element after byte-wise sort wins.
        group.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        kept.push(group[group.length - 1]);
        skipped.duplicate += group.length - 1;
      }
    }
    unique = kept;
  }

  // Materialize FileResult and drop content (free memory).
  for (const c of unique) {
    results.push({ path: c.path, language: c.language, counts: c.counts });
  }

  // Aggregate per-language.
  const byLangMap = new Map<string, LanguageStat>();
  for (const r of results) {
    let s = byLangMap.get(r.language);
    if (!s) {
      s = { language: r.language, files: 0, counts: emptyCounts() };
      byLangMap.set(r.language, s);
    }
    s.files++;
    s.counts = addCounts(s.counts, r.counts);
  }
  const byLanguage = Array.from(byLangMap.values()).sort((a, b) => b.counts.code - a.counts.code);

  const total_: LanguageStat = {
    language: "Total",
    files: results.length,
    counts: byLanguage.reduce<LineCounts>((acc, l) => addCounts(acc, l.counts), emptyCounts()),
  };

  return { files: results, byLanguage, total: total_, skipped };
}
