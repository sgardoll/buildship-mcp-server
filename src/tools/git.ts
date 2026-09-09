import { execFileSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { assertRepoPath, resolveRepoRoot, withRepoMutationLock } from "../repo.js";
import { assertDeploymentValid, validateChangedBuildshipPaths } from "./validation.js";

const BUILDSHIP_PATHS = ["nodes", "workflows", "flow-id-to-label"];

export const SyncToGitSchema = z.object({
  message: z.string().min(1).describe("Commit message for the changes."),
  push: z
    .boolean()
    .default(true)
    .describe("Whether to push to the remote after committing. Set false to commit only."),
});

export type SyncToGitInput = z.infer<typeof SyncToGitSchema>;

/**
 * Stage, commit, and optionally push changes in the BuildShip repo's git
 * working tree. Uses execFileSync (no shell) to prevent injection.
 *
 * Only BuildShip-managed directories are staged. A deployment validation gate
 * runs before the index is changed, and pre-existing staged changes are
 * rejected so the commit boundary remains explicit.
 */
export async function syncToGit(raw: unknown) {
  const { message, push } = SyncToGitSchema.parse(raw);
  return withRepoMutationLock(() => syncToGitUnlocked(message, push));
}

async function syncToGitUnlocked(message: string, push: boolean) {
  const root = await resolveRepoRoot();

  // Verify this is a git repository.
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `${root} is not a git repository. Enable BuildShip GitHub Integration to sync changes.`,
    );
  }

  // Porcelain v1 reports paths from the Git root even when BuildShip lives in
  // a subdirectory of a larger repository. Validation and pathspecs use cwd.
  const gitPrefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: root,
    encoding: "utf8",
  }).replace(/\n$/, "");

  try {
    execFileSync("git", ["diff", "--cached", "--quiet", "--"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Refusing to sync while the git index already contains staged changes. Commit or unstage them first.",
    );
  }

  // Check only BuildShip-managed files; never absorb unrelated repo changes.
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...BUILDSHIP_PATHS],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (!status) {
    if (push) {
      const result = pushToRemote(root);
      return {
        committed: false,
        ...result,
        filesChanged: 0,
        message: result.pushed
          ? "BuildShip files are clean; pushed existing commits."
          : "BuildShip files are clean; push failed.",
      };
    }
    return {
      committed: false,
      pushed: false,
      filesChanged: 0,
      message: "Nothing to commit — BuildShip files are clean.",
    };
  }

  // With -z paths are literal, and rename/copy records contain the destination
  // followed by a separate source field. Neither quoting nor arrows are syntax.
  const records = status.split("\0");
  const changedPaths: string[] = [];
  let filesChanged = 0;
  for (let i = 0; i < records.length - 1; i++) {
    const record = records[i];
    changedPaths.push(record.slice(3));
    filesChanged++;
    if (record.slice(0, 2).match(/[RC]/)) {
      changedPaths.push(records[++i]);
    }
  }
  const localPaths = changedPaths.map((file) => {
    if (!file.startsWith(gitPrefix)) {
      throw new Error(`Git reported a changed path outside the BuildShip directory: ${file}`);
    }
    const localPath = file.slice(gitPrefix.length);
    if (
      !BUILDSHIP_PATHS.some(
        (managed) => localPath === managed || localPath.startsWith(`${managed}/`),
      )
    ) {
      throw new Error(`Git reported a changed path outside BuildShip-managed paths: ${file}`);
    }
    return localPath;
  });
  await Promise.all(localPaths.map((file) => assertRepoPath(path.resolve(root, file))));
  assertDeploymentValid(await validateChangedBuildshipPaths(localPaths));
  // Limit staging to the paths we actually inspected. Literal, NUL-delimited
  // pathspecs handle unusual filenames, deletions and absent optional directories.
  const pathspecs = [...new Set(localPaths)].map((file) => `:(literal)${file}`);
  const pathspecInput = `${pathspecs.join("\0")}\0`;

  // Commit.
  try {
    execFileSync("git", ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      cwd: root,
      encoding: "utf8",
      input: pathspecInput,
      stdio: ["pipe", "pipe", "pipe"],
    });
    execFileSync("git", ["commit", "-m", message], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    let rollbackError: unknown;
    try {
      execFileSync("git", ["reset", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        cwd: root,
        input: pathspecInput,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (resetError) {
      rollbackError = resetError;
    }
    throw new Error(
      rollbackError
        ? `Git sync failed; index rollback also failed: ${String(rollbackError)}; original error: ${String(error)}`
        : `Git sync failed; staged BuildShip changes were rolled back: ${String(error)}`,
    );
  }

  const commitHash = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();

  // A push cannot be rolled back safely once the commit exists. Report an
  // explicit partial result so callers can retry without creating a new commit.
  const { pushed, pushError } = push ? pushToRemote(root) : { pushed: false, pushError: null };

  return {
    committed: true,
    commitHash,
    pushed,
    pushError,
    filesChanged,
    message,
  };
}

function pushToRemote(root: string): { pushed: boolean; pushError: string | null } {
  try {
    execFileSync("git", ["push"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { pushed: true, pushError: null };
  } catch (error) {
    return { pushed: false, pushError: error instanceof Error ? error.message : String(error) };
  }
}
