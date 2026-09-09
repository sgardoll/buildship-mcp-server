import type { ZodTypeAny } from "zod";
import { zodToJsonSchema as toJsonSchema } from "zod-to-json-schema";

/**
 * Wrap zod-to-json-schema with a stable shape suitable for MCP `inputSchema`.
 * Keep the generated draft-07 dialect declaration: MCP defaults to 2020-12
 * when `$schema` is absent. Inline references for client compatibility.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json = toJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  return json;
}
