import { inflate, ungzip } from "pako";
import type { FileEntry } from "../cloc";
import { looksBinary } from "./binary";

const BLOCK = 512;
const TYPEFLAG_OFFSET = 156;

type TarEntry = {
  path: string;
  data: Uint8Array;
};

function readString(view: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < offset + length; i++) {
    if (view[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder("utf-8").decode(view.subarray(offset, end));
}

function readOctal(view: Uint8Array, offset: number, length: number): number {
  let s = "";
  for (let i = offset; i < offset + length; i++) {
    const c = view[i];
    if (c === 0 || c === 0x20) continue;
    s += String.fromCharCode(c);
  }
  return s.length === 0 ? 0 : parseInt(s, 8) || 0;
}

function* iterTar(buf: Uint8Array): Generator<TarEntry> {
  let pos = 0;
  let pendingLongName: string | null = null;
  while (pos + BLOCK <= buf.length) {
    let allZero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (buf[pos + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      pos += BLOCK;
      continue;
    }

    const name = readString(buf, pos, 100);
    const size = readOctal(buf, pos + 124, 12);
    const typeflagByte = buf[pos + TYPEFLAG_OFFSET];
    const prefix = readString(buf, pos + 345, 155);
    const fullName = prefix ? prefix + "/" + name : name;

    pos += BLOCK;
    const dataStart = pos;
    const dataEnd = dataStart + size;
    pos = dataEnd;
    if (size % BLOCK !== 0) pos += BLOCK - (size % BLOCK);
    if (pos > buf.length) break;

    // GNU long-name: data is the filename for the NEXT entry.
    if (typeflagByte === 0x4c) {
      pendingLongName = readString(buf, dataStart, size).replace(/\0+$/, "");
      continue;
    }
    // GNU long-link: irrelevant for our purposes.
    if (typeflagByte === 0x4b) continue;

    // Regular file: typeflag '0' (0x30) or NUL byte (0x00).
    const isRegular = typeflagByte === 0x30 || typeflagByte === 0x00 || typeflagByte === undefined;
    const effectiveName = pendingLongName ?? fullName;
    pendingLongName = null;

    if (isRegular && !effectiveName.endsWith("/")) {
      yield { path: effectiveName, data: buf.subarray(dataStart, dataEnd) };
    }
  }
}

export async function extractTar(buffer: ArrayBuffer, opts: { gzip?: boolean } = {}): Promise<FileEntry[]> {
  let bytes = new Uint8Array(buffer);
  if (opts.gzip || isGzip(bytes)) {
    bytes = ungzip(bytes);
  }
  const entries: FileEntry[] = [];
  for (const e of iterTar(bytes)) {
    const data = e.data;
    entries.push({
      path: stripLeadingDot(e.path),
      size: data.byteLength,
      read: async () => {
        if (looksBinary(data)) return null;
        return new TextDecoder("utf-8", { fatal: false }).decode(data);
      },
    });
  }
  return entries;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isZlib(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda);
}

export function maybeInflate(bytes: Uint8Array): Uint8Array {
  if (isGzip(bytes)) return ungzip(bytes);
  if (isZlib(bytes)) return inflate(bytes);
  return bytes;
}

function stripLeadingDot(p: string): string {
  if (p.startsWith("./")) return p.slice(2);
  return p;
}
