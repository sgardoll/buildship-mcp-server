#!/usr/bin/env node
/**
 * init-remote — configure the git remote for this repository.
 *
 * Usage:
 *   npm run init-remote                        # interactive prompt
 *   BUILDSHIP_GIT_REMOTE=... npm run init-remote  # non-interactive
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runGit(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function getCurrentRemotes() {
  try {
    const out = runGit(["remote", "-v"]);
    return out || "(none)";
  } catch {
    return "(not a git repository)";
  }
}

function setRemote(url) {
  try {
    runGit(["remote", "remove", "origin"]);
  } catch {
    // no existing origin — fine
  }
  runGit(["remote", "add", "origin", url]);
}

async function prompt(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(query, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

async function main() {
  // 1. Show current state
  console.log("\nCurrent git remotes:\n");
  console.log(`  ${getCurrentRemotes()}`);
  console.log("");

  // 2. Env var shortcut
  const envUrl = process.env.BUILDSHIP_GIT_REMOTE;
  if (envUrl) {
    console.log(`Using BUILDSHIP_GIT_REMOTE=${envUrl}`);
    setRemote(envUrl);
    console.log(`\n✓ Remote set to: ${envUrl}\n`);
    return;
  }

  // 3. Interactive prompt
  const url = await prompt("Enter your git remote URL (or press Enter to skip): ");
  if (!url) {
    console.log("Skipped. Remote unchanged.\n");
    return;
  }

  setRemote(url);
  console.log(`\n✓ Remote set to: ${url}\n`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
