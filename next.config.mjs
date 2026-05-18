// Build mode is picked via env vars so the same source serves three targets:
//   - `npm run dev`               → no flags, regular dev server
//   - `npm run build` (Docker)    → NEXT_TARGET=standalone, Node server output
//   - `npm run build:export`      → NEXT_TARGET=export, static `out/` for GH Pages
//
// For GitHub Pages under a project path (e.g. https://<user>.github.io/cloc-web/),
// also set NEXT_BASE_PATH=/cloc-web so assets resolve correctly.

const target = process.env.NEXT_TARGET; // "standalone" | "export" | undefined
const basePath = process.env.NEXT_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(target === "standalone" ? { output: "standalone" } : {}),
  ...(target === "export" ? { output: "export", trailingSlash: true } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // Surface the basePath to the runtime so /wasm/* URLs can be prefixed
  // even though they're loaded via raw `import()` rather than Next's link
  // helpers.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
