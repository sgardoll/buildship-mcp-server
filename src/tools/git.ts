import { execFileSync } from "node:child_process";
import { z } from "zod";
import { resolveRepoRoot } from "../repo.js";

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
 * Push failures are soft — the commit succeeds even if the remote is
 * unreachable or authentication fails. The caller receives pushError
 * so they can retry the push separately.
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

  // Check for uncommitted changes.
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();

  if (!status) {
    return {
      committed: false,
      pushed: false,
      filesChanged: 0,
      message: "Nothing to commit — working tree clean.",
    };
  }

  const filesChanged = status.split("\n").length;

  // Stage all changes (nodes, workflows, flow-id-to-label).
  execFileSync("git", ["add", "-A"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Commit.
  execFileSync("git", ["commit", "-m", message], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const commitHash = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();

  // Push (soft failure — commit succeeded even if push fails).
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
