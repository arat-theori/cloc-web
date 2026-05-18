// Thin TypeScript wrapper around the cloc-rs WASM module.
// The module is served at /wasm/cloc_rs_bg.wasm; we load it lazily on first use.

type WasmModule = {
  count_with_language: (language: string, content: string) => CountResult | null;
  count_file: (path: string, content: string) => CountResult | null;
  detect_language: (path: string, head?: string | null) => string | undefined;
  detect_language_with_content: (path: string, content: string) => string | undefined;
  is_ignored_path: (path: string) => boolean;
  is_not_code: (path: string) => boolean;
};

export type CountResult = {
  language?: string | null;
  total: number;
  blank: number;
  comment: number;
  code: number;
};

let modPromise: Promise<WasmModule> | null = null;

// Static exports on GitHub Pages live under a project sub-path
// (e.g. /cloc-web), so prepend the configured basePath to the WASM URLs.
// `webpackIgnore: true` means Next doesn't rewrite the dynamic import for us.
const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function loadCloc(): Promise<WasmModule> {
  if (!modPromise) {
    modPromise = (async () => {
      // Dynamic import so the bundler emits a separate chunk that fetches the
      // glue + wasm together. The files come from cloc-rs/pkg/ via public/wasm/.
      const glueUrl = `${BASE}/wasm/cloc_rs.js`;
      const wasmUrl = new URL(`${BASE}/wasm/cloc_rs_bg.wasm`, window.location.href);
      const mod = (await import(/* webpackIgnore: true */ glueUrl)) as {
        default: (input?: string | URL) => Promise<unknown>;
        count_with_language: WasmModule["count_with_language"];
        count_file: WasmModule["count_file"];
        detect_language: WasmModule["detect_language"];
        detect_language_with_content: WasmModule["detect_language_with_content"];
        is_ignored_path: WasmModule["is_ignored_path"];
        is_not_code: WasmModule["is_not_code"];
      };
      await mod.default(wasmUrl);
      return {
        count_with_language: mod.count_with_language,
        count_file: mod.count_file,
        detect_language: mod.detect_language,
        detect_language_with_content: mod.detect_language_with_content,
        is_ignored_path: mod.is_ignored_path,
        is_not_code: mod.is_not_code,
      };
    })();
  }
  return modPromise;
}
