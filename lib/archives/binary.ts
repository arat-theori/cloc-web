// Faithful port of Perl's `-B` heuristic (which cloc uses to decide whether
// a file is binary). Examines the first 512 bytes:
//   1. Any NUL byte → BINARY (decisive).
//   2. Otherwise count "odd" bytes:
//        - low-ASCII non-whitespace control bytes  (weight 1)
//        - high-bit bytes that don't form valid UTF-8 sequences (weight 1)
//      If `odd * 3 > total`, BINARY; else TEXT.
//
// The 512-byte window matters: a `.txt` with a stray NUL beyond byte 512
// is TEXT to cloc but would be BINARY under the older "first 8 KiB" check
// we had, causing the per-language totals to drift.
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 512);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return true;
  }
  let weight = 0;
  let i = 0;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      // ASCII: tab/LF/VT/FF/CR are whitespace; everything else < 0x20 is odd.
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0b && b !== 0x0c && b !== 0x0d) {
        weight++;
      }
      i++;
      continue;
    }
    const seqLen = utf8Len(b);
    if (seqLen === 0 || i + seqLen > n) {
      weight++;
      i++;
      continue;
    }
    let valid = true;
    for (let k = 1; k < seqLen; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      weight++;
      i++;
    } else {
      i += seqLen;
    }
  }
  return weight * 3 > n;
}

function utf8Len(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead < 0xc2) return 0;
  if (lead < 0xe0) return 2;
  if (lead < 0xf0) return 3;
  if (lead < 0xf5) return 4;
  return 0;
}

// FNV-1a 64-bit over RAW BYTES. cloc dedups by content equality within a
// size bucket; we have to hash the bytes the file was read as, not its
// lossy UTF-8 decoding — two files encoded in different legacy code pages
// (e.g. neovim's slovak_cp1250.vim vs slovak_iso-8859-2.vim) decode to the
// same string of U+FFFDs and would otherwise collide.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;
export function bytesHash(bytes: Uint8Array): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ BigInt(bytes[i])) * FNV_PRIME & U64_MASK;
  }
  return h.toString(16);
}
