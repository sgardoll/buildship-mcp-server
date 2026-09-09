import { readFileSync } from "node:fs";

// Both src/ and compiled dist/ live directly below the package root. Keep the
// handshake, CLI, and update checker tied to the installed package metadata.
const metadata: unknown = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (
  typeof metadata !== "object" ||
  metadata === null ||
  !("version" in metadata) ||
  typeof metadata.version !== "string"
) {
  throw new Error("The installed package.json is missing its version.");
}

export const SERVER_VERSION = metadata.version;
