import type { ZodTypeAny } from "zod";
import { zodToJsonSchema as toJsonSchema } from "zod-to-json-schema";

/**
 * Wrap zod-to-json-schema with a stable shape suitable for MCP `inputSchema`.
 * MCP expects a draft-7-style object schema; we strip the top-level `$schema`
 * key and the `$ref` indirection that `zod-to-json-schema` emits by default.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json = toJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}
