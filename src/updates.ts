import { z } from "zod";
import { SERVER_VERSION } from "./version.js";

const RELEASES_API = "https://api.github.com/repos/sgardoll/buildship-mcp-server/releases/latest";
const RELEASES_PAGE = "https://github.com/sgardoll/buildship-mcp-server/releases";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

export const CheckForUpdatesSchema = z.object({
  force: z
    .boolean()
    .default(false)
    .describe("Bypass the cached update result and check GitHub again."),
});

export interface UpdateCheckResult {
  installedVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  status: "update_available" | "up_to_date" | "no_release" | "unavailable";
  releaseUrl: string | null;
  checkedAt: string;
  cached: boolean;
  message: string;
  updateInstructions: string[];
}

interface UpdateCheckerOptions {
  installedVersion?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

function stableVersion(value: string): { normalized: string; parts: bigint[] } | null {
  if (value.length > 128) return null;
  const match =
    /^v?((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return null;
  return { normalized: value.replace(/^v/, ""), parts: match.slice(2, 5).map(BigInt) };
}

function isNewer(latest: bigint[], installed: bigint[]): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (latest[index] !== installed[index]) return latest[index] > installed[index];
  }
  return false;
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Release response exceeds the size limit.");
  }
  if (!response.body) throw new Error("Release response is empty.");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("Update check aborted.");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Release response exceeds the size limit.");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

/** No request is made until the returned checker is explicitly called. */
export function createUpdateChecker(options: UpdateCheckerOptions = {}) {
  const installedVersion = options.installedVersion ?? SERVER_VERSION;
  const fetchRelease = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 3000;
  let cache: { result: UpdateCheckResult; expiresAt: number } | undefined;
  let pending: Promise<UpdateCheckResult> | undefined;

  async function query(): Promise<UpdateCheckResult> {
    const base: UpdateCheckResult = {
      installedVersion,
      latestVersion: null,
      updateAvailable: null,
      status: "unavailable",
      releaseUrl: null,
      checkedAt: new Date(now()).toISOString(),
      cached: false,
      message: "Update check unavailable. Try again later or inspect the GitHub releases page.",
      updateInstructions: [],
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = async (): Promise<UpdateCheckResult> => {
        const response = await fetchRelease(RELEASES_API, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        if (response.status === 404) {
          void response.body?.cancel().catch(() => {});
          return {
            ...base,
            status: "no_release",
            updateAvailable: false,
            releaseUrl: RELEASES_PAGE,
            message: "No published stable GitHub release is available for comparison.",
          };
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          return { ...base, message: `GitHub update check unavailable (HTTP ${response.status}).` };
        }
        const release = await readBoundedJson(response, controller.signal);
        if (
          typeof release !== "object" ||
          release === null ||
          !("tag_name" in release) ||
          typeof release.tag_name !== "string" ||
          !("draft" in release) ||
          release.draft !== false ||
          !("prerelease" in release) ||
          release.prerelease !== false
        ) {
          return { ...base, message: "GitHub returned invalid stable release metadata." };
        }
        const latest = stableVersion(release.tag_name);
        const installed = stableVersion(installedVersion);
        if (!latest || !installed) {
          return { ...base, message: "Release versions are not valid stable semantic versions." };
        }
        const updateAvailable = isNewer(latest.parts, installed.parts);
        return {
          ...base,
          latestVersion: latest.normalized,
          updateAvailable,
          status: updateAvailable ? "update_available" : "up_to_date",
          releaseUrl: `${RELEASES_PAGE}/tag/${encodeURIComponent(release.tag_name)}`,
          updateInstructions: updateAvailable
            ? [
                "Review the release notes before updating.",
                "In your buildship-mcp-server checkout, run git status and preserve any local edits before switching versions.",
                "Run git fetch origin --tags.",
                `Run git switch --detach refs/tags/${release.tag_name}, then npm ci.`,
                "Run node dist/index.js --version to verify the installed version, then restart your MCP client.",
              ]
            : [],
          message: updateAvailable
            ? `Version ${latest.normalized} is available; installed version is ${installedVersion}.`
            : "No newer stable GitHub release is available.",
        };
      };
      return await Promise.race([
        request(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Update check timed out."));
          }, timeoutMs);
        }),
      ]);
    } catch {
      return base;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return async (raw: unknown): Promise<UpdateCheckResult> => {
    const { force } = CheckForUpdatesSchema.parse(raw);
    let result: UpdateCheckResult;
    let cached = false;
    if (pending) {
      result = await pending;
    } else if (!force && cache && now() < cache.expiresAt) {
      result = cache.result;
      cached = true;
    } else {
      pending = query();
      try {
        result = await pending;
        cache = {
          result,
          expiresAt: now() + (result.status === "unavailable" ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
        };
      } finally {
        pending = undefined;
      }
    }
    return { ...result, cached, updateInstructions: [...result.updateInstructions] };
  };
}

export const checkForUpdates = createUpdateChecker();
