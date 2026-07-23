import { execFileSync } from "node:child_process";
import { z } from "zod";
import { resolveRepoRoot } from "../repo.js";
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
    ["status", "--porcelain", "--untracked-files=all", "--", ...BUILDSHIP_PATHS],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trimEnd();

  if (!status) {
    return {
      committed: false,
      pushed: false,
      filesChanged: 0,
      message: "Nothing to commit — BuildShip files are clean.",
    };
  }

  const changedPaths = status
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = line.slice(3);
      return value.includes(" -> ") ? (value.split(" -> ").at(-1) ?? value) : value;
    });
  assertDeploymentValid(await validateChangedBuildshipPaths(changedPaths));
  const filesChanged = changedPaths.length;

  // Stage all and only BuildShip-managed changes.
  execFileSync("git", ["add", "-A", "--", ...BUILDSHIP_PATHS], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Commit.
  try {
    execFileSync("git", ["commit", "-m", message], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    try {
      execFileSync("git", ["reset", "--quiet", "--", ...BUILDSHIP_PATHS], {
        cwd: root,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // The original commit error is more useful; a repo without HEAD cannot reset.
    }
    throw new Error(
      `Git commit failed; staged BuildShip changes were rolled back: ${String(error)}`,
    );
  }

  const commitHash = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();

  // A push cannot be rolled back safely once the commit exists. Report an
  // explicit partial result so callers can retry without creating a new commit.
  let pushed = false;
  let pushError: string | null = null;
  if (push) {
    try {
      execFileSync("git", ["push"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      pushed = true;
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    committed: true,
    commitHash,
    pushed,
    pushError,
    filesChanged,
    message,
  };
}
