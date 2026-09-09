import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function checkVersion(version, manifest, lock) {
  if (typeof version !== "string" || version.trim() !== version || !STABLE_VERSION.test(version)) {
    throw new Error(
      "Release version must be stable MAJOR.MINOR.PATCH without a v prefix or leading zeroes.",
    );
  }
  for (const [source, actual] of [
    ["package.json", manifest.version],
    ["package-lock.json", lock.version],
    ['package-lock.json packages[""]', lock.packages?.[""]?.version],
  ]) {
    if (actual !== version) {
      throw new Error(`${source} version ${String(actual)} does not match requested ${version}.`);
    }
  }
  return `v${version}`;
}

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A missing tag is the only API failure that permits release preparation. */
export function checkRemote(tag, repository, run = runGh) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must identify an owner/repository for remote checks.");
  }
  let tagExists = true;
  try {
    run(["api", "--include", `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`]);
  } catch (error) {
    const status = String(error.stdout ?? "").match(/^HTTP\/[\d.]+\s+(\d{3})\b/m)?.[1];
    if (status !== "404") {
      throw new Error(`Unable to establish whether ${tag} exists; refusing release.`, {
        cause: error,
      });
    }
    tagExists = false;
  }
  if (tagExists) throw new Error(`Tag ${tag} already exists; refusing to reuse it.`);

  // Listing includes authenticated draft releases, unlike the published-release-by-tag endpoint.
  const pages = JSON.parse(
    run(["api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`]),
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Unexpected release API response; refusing release.");
  }
  if (pages.flat().some((release) => release.tag_name === tag)) {
    throw new Error(`Release ${tag} already exists, including drafts; refusing to reuse it.`);
  }
}

async function main() {
  const [version, mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode !== undefined && mode !== "--remote")) {
    throw new Error("Usage: node scripts/check-release.mjs VERSION [--remote]");
  }
  const [manifest, lock] = await Promise.all(
    ["../package.json", "../package-lock.json"].map(async (relative) =>
      JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8")),
    ),
  );
  const tag = checkVersion(version, manifest, lock);
  if (mode === "--remote") checkRemote(tag, process.env.GITHUB_REPOSITORY);
  process.stdout.write(`Release version verified: ${tag}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
