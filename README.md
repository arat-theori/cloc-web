# cloc-web

In-browser line counter, like [`cloc`](https://github.com/AlDanial/cloc) but
running entirely client-side. Drop a `.zip` / `.tar.gz`, paste a GitHub URL,
and get a cloc-compatible breakdown by language without uploading the source
anywhere.

The counting logic is a Rust port of cloc compiled to WebAssembly. See
[`cloc-rs`](https://github.com/arat-theori/cloc-rs) for the engine — it lives
in its own repository and produces the artifacts at `public/wasm/` that this
app loads at runtime. Those artifacts are **not** committed; they're built
fresh by Docker (or by running `wasm-pack` locally — see below).

## Stack

- Next.js 15 (App Router) + React 19
- Tailwind CSS
- [`cloc-rs`](https://github.com/arat-theori/cloc-rs) WASM (~1 MiB) loaded on
  first counting request
- `jszip` + `pako` for in-browser archive extraction
- GitHub trees API for "paste a repo URL" mode (no auth, anonymous tier
  applies)

## Run locally

Prereq: Node 20+, Rust + [`wasm-pack`](https://rustwasm.github.io/wasm-pack/)
(needed once to produce `public/wasm/`), and a `cloc-rs` checkout at
`../cloc-rs` (or wherever).

```sh
# Build the WASM engine into public/wasm/ (one-time, or after cloc-rs edits)
(cd ../cloc-rs && wasm-pack build --target web --release \
    --out-dir ../cloc-web/public/wasm)

# Run the app
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run build        # production build → .next/
npm start            # serve the production build
```

`public/wasm/` is gitignored — the build pipeline owns it. If you'd rather
skip the Rust toolchain entirely, use Docker (next section).

## Run with Docker

Prereq: Docker 24+ (Buildx / Compose v2.17+ for `additional_contexts`).

The Dockerfile compiles `cloc-rs` to WebAssembly from source as part of the
build, so the runtime image always matches the engine you have checked out.
By default it expects the cloc-rs repo at `../cloc-rs` (sibling directory):

```
parent/
├── cloc-web/        ← you are here
└── cloc-rs/
```

```sh
# from cloc-web/
docker compose up --build
# → http://localhost:3000
```

If your `cloc-rs` checkout lives elsewhere, point at it via env:

```sh
CLOC_RS_PATH=/abs/path/to/cloc-rs docker compose up --build
```

The build is three stages — `rust:1-bookworm` to compile WASM via
`wasm-pack`, `node:20-alpine` to run `next build`, and another
`node:20-alpine` for the runtime serving Next.js's standalone output. First
build takes a few minutes (Rust cold compile); subsequent rebuilds reuse
layer caches.

## Architecture sketch

```
DropZone / UrlInput (components/)
    └─ extractArchive (lib/archives/)        # zip + tar.gz → FileEntry[]
    └─ listGitHubFiles (lib/github.ts)       # repo URL → FileEntry[]
        └─ clocFiles (lib/cloc/index.ts)     # walk + dedup + count
            └─ loadCloc (lib/wasm/cloc.ts)   # lazy-load WASM module
                └─ public/wasm/cloc_rs.js    # cloc-rs entry
```

`lib/cloc/index.ts` matches cloc's default behavior — file-type detection,
binary check, size+hash dedup (`--skip-uniqueness` OFF), and per-language
aggregation.

## License

MIT. See `LICENSE`. The bundled `cloc-rs` engine is also MIT; cloc itself is
GPLv2 but is not redistributed here (the engine is a clean-room Rust port of
cloc's algorithm).
