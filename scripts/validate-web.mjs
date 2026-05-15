#!/usr/bin/env node
// Re-runs the algorithm the web app uses (lib/cloc/index.ts) against a
// local directory tree. Loads the same cloc-rs WASM (nodejs target) the
// browser loads (web target), then prints a cloc-style totals report.
//
//   node scripts/validate-web.mjs <dir>
//
// The output format matches `cloc <dir>` so it can be diff'd directly
// against the harness in cloc-rs/examples/validate.rs.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const wasmDir = path.resolve(here, "..", "cloc-rs", "pkg-node");
const wasm = await import(path.join(wasmDir, "cloc_rs.js"));

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/validate-web.mjs <dir>");
  process.exit(1);
}

// ---------- Perl -B binary check (mirrors lib/archives/binary.ts) ----------
function looksBinary(bytes) {
  const n = Math.min(bytes.length, 512);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  let weight = 0;
  let i = 0;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0b && b !== 0x0c && b !== 0x0d) weight++;
      i++;
      continue;
    }
    const seq = utf8Len(b);
    if (seq === 0 || i + seq > n) { weight++; i++; continue; }
    let valid = true;
    for (let k = 1; k < seq; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) { valid = false; break; }
    }
    if (!valid) { weight++; i++; } else { i += seq; }
  }
  return weight * 3 > n;
}
function utf8Len(lead) {
  if (lead < 0x80) return 1;
  if (lead < 0xc2) return 0;
  if (lead < 0xe0) return 2;
  if (lead < 0xf0) return 3;
  if (lead < 0xf5) return 4;
  return 0;
}

// ---------- FNV-1a 64-bit over RAW BYTES (mirrors lib/archives/binary.ts) ----------
// Must hash the bytes, not the decoded string — lossy UTF-8 decoding can
// collapse files with different legacy encodings to the same string.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;
function bytesHash(bytes) {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ BigInt(bytes[i])) * FNV_PRIME & U64_MASK;
  }
  return h.toString(16);
}

// ---------- Walk ----------
function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      // cloc follows file symlinks but not directory symlinks.
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isFile()) out.push(p);
      continue;
    }
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

const all = [];
walk(path.resolve(root), all);

// ---------- Phase 1: path-only pre-filter ----------
const skipped = { binary: 0, ignored: 0, tooLarge: 0, unknown: 0, error: 0, duplicate: 0, empty: 0 };
const candidates = [];
for (const p of all) {
  if (wasm.is_ignored_path(p)) { skipped.ignored++; continue; }
  let size;
  try { size = fs.statSync(p).size; } catch { skipped.error++; continue; }
  if (wasm.is_not_code(p)) { skipped.unknown++; continue; }
  candidates.push({ path: p, size });
}

// ---------- Phase 2: read + detect + count ----------
const counted = [];
for (const c of candidates) {
  let bytes;
  try { bytes = fs.readFileSync(c.path); } catch { skipped.error++; continue; }
  if (bytes.length === 0) { skipped.empty++; continue; }
  if (looksBinary(bytes)) { skipped.binary++; continue; }
  const hash = bytesHash(bytes);
  const content = bytes.toString("utf8");
  const lang = wasm.detect_language_with_content(c.path, content);
  if (!lang) { skipped.unknown++; continue; }
  const r = wasm.count_with_language(lang, content);
  if (!r) { skipped.error++; continue; }
  counted.push({
    path: c.path,
    language: lang,
    size: c.size, // raw byte size — keep buckets aligned with cloc-rs validate
    hash,
    counts: { blank: r.blank, comment: r.comment, code: r.code },
  });
}

// ---------- Phase 3: dedup (cloc default — bucket by size + hash, last-wins) ----------
const bySize = new Map();
for (const c of counted) {
  const list = bySize.get(c.size) ?? [];
  list.push(c);
  bySize.set(c.size, list);
}
const kept = [];
for (const list of bySize.values()) {
  if (list.length === 1) { kept.push(list[0]); continue; }
  const byHash = new Map();
  for (const c of list) {
    const sub = byHash.get(c.hash) ?? [];
    sub.push(c);
    byHash.set(c.hash, sub);
  }
  for (const group of byHash.values()) {
    group.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    kept.push(group[group.length - 1]);
    skipped.duplicate += group.length - 1;
  }
}

// ---------- Aggregate ----------
const byLang = new Map();
for (const k of kept) {
  let s = byLang.get(k.language);
  if (!s) { s = { files: 0, blank: 0, comment: 0, code: 0 }; byLang.set(k.language, s); }
  s.files++;
  s.blank += k.counts.blank;
  s.comment += k.counts.comment;
  s.code += k.counts.code;
}

const rows = Array.from(byLang.entries()).map(([lang, s]) => ({ lang, ...s }));
rows.sort((a, b) => b.code - a.code);

console.log(`${"Language".padEnd(28)} ${"files".padStart(6)} ${"blank".padStart(10)} ${"comment".padStart(10)} ${"code".padStart(10)}`);
let tF = 0, tB = 0, tC = 0, tK = 0;
for (const r of rows) {
  console.log(`${r.lang.padEnd(28)} ${String(r.files).padStart(6)} ${String(r.blank).padStart(10)} ${String(r.comment).padStart(10)} ${String(r.code).padStart(10)}`);
  tF += r.files; tB += r.blank; tC += r.comment; tK += r.code;
}
console.log(`${"SUM:".padEnd(28)} ${String(tF).padStart(6)} ${String(tB).padStart(10)} ${String(tC).padStart(10)} ${String(tK).padStart(10)}`);
