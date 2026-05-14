// Detect binary content via a NUL byte in the first 8KB.
// cloc itself uses a similar heuristic when --read-binary-files is off.
export function looksBinary(bytes: Uint8Array): boolean {
  const len = Math.min(bytes.length, 8192);
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
