import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_ENV_KEY = "BUILDSHIP_REPO";

let cachedRoot: string | null = null;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Join `base` with `segments` and verify the result stays inside `base`.
 * Prevents path traversal via `..`, absolute paths, or null bytes in
 * user-supplied tool parameters. Throws if the resolved path escapes `base`.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  const joined = path.join(base, ...segments);
  const resolved = path.resolve(joined);
  const resolvedBase = path.resolve(base);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(
      `Path escapes the allowed directory: ${segments.join("/")}`,
    );
  }
  return resolved;
}

async function looksLikeBuildshipRepo(dir: string): Promise<boolean> {
  // A BuildShip repo always has nodes/ and workflows/. The flow-id-to-label/
  // directory may not exist yet in a fresh repo, so we don't require it here —
  // it will be created on demand by createWorkflow/createNode/setLabel.
  return (
    (await exists(path.join(dir, "nodes"))) &&
    (await exists(path.join(dir, "workflows")))
  );
}

/**
 * Resolve the BuildShip repo root. Search order:
 *   1. BUILDSHIP_REPO env var (if set, must point at a valid repo)
 *   2. Walk upward from the server's own location until we find one
 *   3. Walk upward from process.cwd()
 */
export async function resolveRepoRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;

  const fromEnv = process.env[FALLBACK_ENV_KEY];
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (!(await looksLikeBuildshipRepo(abs))) {
      throw new Error(
        `${FALLBACK_ENV_KEY}=${fromEnv} does not look like a BuildShip repo (missing nodes/ or workflows/).`,
      );
    }
    cachedRoot = abs;
    return abs;
  }

  const candidates = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of candidates) {
    let dir = start;
    while (true) {
      if (await looksLikeBuildshipRepo(dir)) {
        cachedRoot = dir;
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(
    "Could not locate the BuildShip repo. Set BUILDSHIP_REPO to its absolute path, or run the server from inside the repo.",
  );
}

export async function nodesDir(): Promise<string> {
  return path.join(await resolveRepoRoot(), "nodes");
}

export async function workflowsDir(): Promise<string> {
  return path.join(await resolveRepoRoot(), "workflows");
}

export async function labelsDir(): Promise<string> {
  return path.join(await resolveRepoRoot(), "flow-id-to-label");
}

export async function readJson<T = unknown>(file: string): Promise<T> {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeText(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const ending = value.endsWith("\n") ? value : value + "\n";
  await fs.writeFile(file, ending, "utf8");
}

export async function readText(file: string): Promise<string> {
  return fs.readFile(file, "utf8");
}

export async function pathExists(p: string): Promise<boolean> {
  return exists(p);
}

export async function listDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Reset the cached repo root. Useful for tests that need to point at different repos. */
export function resetRepoRootCache(): void {
  cachedRoot = null;
}
