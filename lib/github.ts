import type { FileEntry } from "./cloc";

export type GitHubRepo = {
  owner: string;
  repo: string;
  ref?: string;
};

const HOST_HINTS = ["github.com", "www.github.com"];

export function parseGitHubUrl(input: string): GitHubRepo | null {
  let raw = input.trim();
  if (!raw) return null;
  // Allow forms like "owner/repo" without scheme/host.
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith("github.com")) {
    if (/^[\w.-]+\/[\w.-]+(?:\/.*)?$/.test(raw)) {
      raw = "https://github.com/" + raw;
    } else {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!HOST_HINTS.includes(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  let repo = parts[1];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  let ref: string | undefined;
  // .../tree/<ref>/...
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    ref = parts[3];
  }
  return { owner, repo, ref };
}

type GhTreeNode = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
  sha: string;
};

type GhTreeResponse = {
  sha: string;
  truncated: boolean;
  tree: GhTreeNode[];
};

type GhRepoResponse = {
  default_branch: string;
};

export type FetchProgress = {
  processed: number;
  total: number;
  currentPath?: string;
};

export type ListResult = {
  ref: string;
  truncated: boolean;
  files: FileEntry[];
};

async function gh<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/vnd.github+json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("GitHub API rate limit reached. Try again later or use a smaller repo.");
    }
    if (res.status === 404) {
      throw new Error("Repository or branch not found on GitHub.");
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listGitHubFiles(repo: GitHubRepo): Promise<ListResult> {
  let ref = repo.ref;
  if (!ref) {
    const info = await gh<GhRepoResponse>(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
    ref = info.default_branch;
  }
  const tree = await gh<GhTreeResponse>(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const files: FileEntry[] = tree.tree
    .filter((n) => n.type === "blob")
    .map((n) => ({
      path: n.path,
      size: n.size,
      read: async () => {
        const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(ref!)}/${n.path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        // Quick binary detection on the bytes.
        const max = Math.min(buf.length, 8192);
        for (let i = 0; i < max; i++) if (buf[i] === 0) return null;
        return new TextDecoder("utf-8", { fatal: false }).decode(buf);
      },
    }));
  return { ref, truncated: tree.truncated, files };
}
