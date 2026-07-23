import { randomUUID } from "node:crypto";
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
    throw new Error(`Path escapes the allowed directory: ${segments.join("/")}`);
  }
  return resolved;
}

async function looksLikeBuildshipRepo(dir: string): Promise<boolean> {
  // A BuildShip repo always has nodes/ and workflows/. The flow-id-to-label/
  // directory may not exist yet in a fresh repo, so we don't require it here —
  // it will be created on demand by createWorkflow/createNode/setLabel.
  return (await exists(path.join(dir, "nodes"))) && (await exists(path.join(dir, "workflows")));
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
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Unable to read required file ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Malformed JSON in ${file}: ${(error as Error).message}`);
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(file: string, value: string): Promise<void> {
  const ending = value.endsWith("\n") ? value : `${value}\n`;
  await writeAtomic(file, ending);
}

export async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Unable to read required file ${file}: ${(error as Error).message}`);
  }
}

export interface TransactionFile {
  file: string;
  content: string;
}

interface FileSnapshot {
  file: string;
  existed: boolean;
  content?: Buffer;
}

let transactionTail: Promise<void> = Promise.resolve();

/**
 * Atomically apply a related set of file changes. Each individual replacement
 * uses temp-file + rename, and any write or post-write validation failure
 * restores every prior file (or removes newly created files/directories).
 */
export async function writeFilesTransaction(
  files: TransactionFile[],
  validate?: () => Promise<void>,
): Promise<void> {
  const previous = transactionTail;
  let release: () => void = () => undefined;
  transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await writeFilesTransactionUnlocked(files, validate);
  } finally {
    release();
  }
}

async function writeFilesTransactionUnlocked(
  files: TransactionFile[],
  validate?: () => Promise<void>,
): Promise<void> {
  const unique = new Set(files.map(({ file }) => path.resolve(file)));
  if (unique.size !== files.length) {
    throw new Error("A file transaction cannot contain duplicate paths.");
  }

  const snapshots: FileSnapshot[] = [];
  const createdDirectories = new Set<string>();
  for (const { file } of files) {
    const resolved = path.resolve(file);
    try {
      snapshots.push({ file: resolved, existed: true, content: await fs.readFile(resolved) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      snapshots.push({ file: resolved, existed: false });
      let dir = path.dirname(resolved);
      while (!(await exists(dir))) {
        createdDirectories.add(dir);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  }

  try {
    for (const { file, content } of files) {
      await writeAtomic(path.resolve(file), content);
    }
    await validate?.();
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const snapshot of [...snapshots].reverse()) {
      try {
        if (snapshot.existed) {
          await writeAtomic(snapshot.file, snapshot.content?.toString("utf8") ?? "");
        } else {
          await fs.rm(snapshot.file, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${snapshot.file}: ${(rollbackError as Error).message}`);
      }
    }
    for (const dir of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try {
        await fs.rmdir(dir);
      } catch (rollbackError) {
        if (
          !["ENOENT", "ENOTEMPTY"].includes((rollbackError as NodeJS.ErrnoException).code ?? "")
        ) {
          rollbackErrors.push(`${dir}: ${(rollbackError as Error).message}`);
        }
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${(error as Error).message}; rollback was incomplete: ${rollbackErrors.join("; ")}`,
      );
    }
    throw error;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  return exists(p);
}

export async function listDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Reset the cached repo root. Useful for tests that need to point at different repos. */
export function resetRepoRootCache(): void {
  cachedRoot = null;
}
