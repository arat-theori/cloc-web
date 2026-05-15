#!/usr/bin/env node
// Print "LANG\tPATH" for each file the web algorithm keeps after dedup.
// Mirrors lib/cloc/index.ts. Used to diff against cloc-rs validate harness.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const wasmDir = path.resolve(here, "..", "cloc-rs", "pkg-node");
const wasm = await import(path.join(wasmDir, "cloc_rs.js"));

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/list-web.mjs <dir>");
  process.exit(1);
}

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

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
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

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const counted = [];
for (const p of all) {
  if (wasm.is_ignored_path(p)) continue;
  let size;
  try { size = fs.statSync(p).size; } catch { continue; }
  if (size > MAX_FILE_BYTES) continue;
  if (wasm.is_not_code(p)) continue;
  let bytes;
  try { bytes = fs.readFileSync(p); } catch { continue; }
  if (bytes.length === 0) continue;
  if (looksBinary(bytes)) continue;
  const hash = bytesHash(bytes);
  const content = bytes.toString("utf8");
  const lang = wasm.detect_language_with_content(p, content);
  if (!lang) continue;
  counted.push({ path: p, language: lang, size: bytes.length, hash });
}

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
  }
}

kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
for (const k of kept) console.log(`${k.language}\t${k.path}`);
