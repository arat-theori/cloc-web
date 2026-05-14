import { loadCloc, type CountResult } from "@/lib/wasm/cloc";

export type LineCounts = { blank: number; comment: number; code: number };

export type FileEntry = {
  path: string;
  /** Lazy reader returning the file content as text. Returns null if unreadable/binary. */
  read: () => Promise<string | null>;
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

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB hard cap per file

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

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

// FNV-1a 64-bit over the UTF-8 bytes of `s`. Used for cloc-style dedup —
// same hash cloc-rs uses internally. Pure JS (no `crypto.subtle`) so it
// works in non-secure contexts (e.g. Docker reached over plain HTTP from
// a non-localhost address, where `crypto.subtle` is `undefined`).
function contentHash(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ BigInt(bytes[i])) * FNV_PRIME & U64_MASK;
  }
  return h.toString(16);
}

export async function clocFiles(files: FileEntry[], opts: ClocOptions = {}): Promise<ClocResult> {
  const onProgress = opts.onProgress;
  const signal = opts.signal;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const wasm = await loadCloc();

  const results: FileResult[] = [];
  const skipped = { binary: 0, ignored: 0, tooLarge: 0, unknown: 0, error: 0, duplicate: 0, empty: 0 };

  // Phase 1: detect language for each file using path (+shebang when content can be
  // peeked cheaply). We can only get shebang after reading, so we delay detection
  // until the content read happens. Pre-filter by path-only rules first to avoid
  // touching files we'll never count.
  type Candidate = { file: FileEntry; pathLang: string | null };
  const candidates: Candidate[] = [];
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
    const pathLang = wasm.detect_language(f.path, null) ?? null;
    candidates.push({ file: f, pathLang });
  }

  const total = candidates.length;
  let processed = 0;

  type Counted = {
    path: string;
    language: string;
    content: string;
    counts: LineCounts;
    size: number;
  };
  const counted: Counted[] = [];

  let nextIdx = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const i = nextIdx++;
      if (i >= candidates.length) return;
      const { file, pathLang } = candidates[i];
      try {
        const content = await file.read();
        if (content === null) {
          skipped.binary++;
        } else if (content.length === 0) {
          // cloc skips zero-byte files by default.
          skipped.empty++;
        } else {
          // If detection by path failed, retry with the content head (shebang).
          let lang = pathLang;
          if (!lang) {
            const head = content.slice(0, 256);
            lang = wasm.detect_language(file.path, head) ?? null;
          }
          if (!lang) {
            skipped.unknown++;
          } else {
            const r: CountResult | null = wasm.count_with_language(lang, content);
            if (r) {
              counted.push({
                path: file.path,
                language: lang,
                content,
                size: content.length,
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
      // Bucket by content hash within the size group.
      const hashes = list.map((c) => contentHash(c.content));
      const byHash = new Map<string, Counted[]>();
      list.forEach((c, idx) => {
        const h = hashes[idx];
        const sub = byHash.get(h) ?? [];
        sub.push(c);
        byHash.set(h, sub);
      });
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
