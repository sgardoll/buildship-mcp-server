import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  listDirs,
  nodesDir,
  pathExists,
  readJson,
  readText,
  safeJoin,
  workflowsDir,
} from "../repo.js";

const NODE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const WORKFLOW_FOLDER_RE = /^[a-z0-9][A-Za-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPLOYABLE_NODE_TYPES = new Set([
  "script",
  "output",
  "branch",
  "loop",
  "parallel",
  "switch",
  "legacy-switch",
  "set-variable",
  "call-workflow",
  "execute-agent",
  "trigger",
]);
const JSON_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

type JsonObject = Record<string, unknown>;

export interface ValidationIssue {
  target: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  checked: string[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(target: string, message: string): ValidationIssue {
  return { target, message };
}

function asObject(value: unknown, target: string, errors: ValidationIssue[]): JsonObject {
  if (!isObject(value)) {
    errors.push(issue(target, "must be a JSON object."));
    return {};
  }
  return value;
}

function validateJsonSchema(
  value: unknown,
  target: string,
  errors: ValidationIssue[],
  requireType = true,
): JsonObject {
  const schema = asObject(value, target, errors);
  if (schema.type === undefined && !requireType) return schema;
  if (typeof schema.type !== "string" || !JSON_SCHEMA_TYPES.has(schema.type)) {
    errors.push(issue(target, "must declare a supported JSON Schema `type`."));
  }
  if (schema.type === "object") {
    const properties = asObject(schema.properties ?? {}, `${target}.properties`, errors);
    for (const [key, property] of Object.entries(properties)) {
      validateJsonSchema(property, `${target}.properties.${key}`, errors, false);
    }
    if (schema.required !== undefined) {
      if (
        !Array.isArray(schema.required) ||
        !schema.required.every((key) => typeof key === "string")
      ) {
        errors.push(issue(`${target}.required`, "must be an array of property names."));
      } else {
        for (const key of schema.required) {
          if (!(key in properties)) {
            errors.push(issue(`${target}.required`, `references missing property \`${key}\`.`));
          }
        }
      }
    }
  }
  if (schema.type === "array") {
    if (!isObject(schema.items)) {
      errors.push(issue(`${target}.items`, "must define the item schema for an array."));
    } else {
      validateJsonSchema(schema.items, `${target}.items`, errors, false);
    }
  }
  return schema;
}

function schemaToTypeScript(value: unknown): string {
  if (!isObject(value)) return "unknown";
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    return value.enum.map((item) => JSON.stringify(item)).join(" | ");
  }
  switch (value.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${schemaToTypeScript(value.items)}>`;
    case "object": {
      const properties = isObject(value.properties) ? value.properties : {};
      const required = new Set(
        Array.isArray(value.required)
          ? value.required.filter((key): key is string => typeof key === "string")
          : [],
      );
      const fields = Object.entries(properties).map(
        ([key, schema]) =>
          `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaToTypeScript(schema)};`,
      );
      return `{ ${fields.join(" ")} }`;
    }
    default:
      return "unknown";
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${line + 1}:${character + 1} ${message}`;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function typeMatchesSchema(type: ts.Type, schema: JsonObject, checker: ts.TypeChecker): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return true;
  if (type.isUnion())
    return type.types.every((member) => typeMatchesSchema(member, schema, checker));
  switch (schema.type) {
    case "string":
      return Boolean(type.flags & ts.TypeFlags.StringLike);
    case "number":
    case "integer":
      return Boolean(type.flags & ts.TypeFlags.NumberLike);
    case "boolean":
      return Boolean(type.flags & ts.TypeFlags.BooleanLike);
    case "null":
      return Boolean(type.flags & ts.TypeFlags.Null);
    case "array":
      return checker.isArrayType(type) || checker.isTupleType(type);
    case "object":
      return Boolean(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive));
    default:
      return true;
  }
}

function typeCheckMainTs(
  source: string,
  inputs: JsonObject,
  output: JsonObject,
  target: string,
  errors: ValidationIssue[],
) {
  const mainFile = "/__buildship_validation__/main.ts";
  const typesFile = "/__buildship_validation__/types.d.ts";
  const types = [
    `type NodeInputs = ${schemaToTypeScript(inputs)};`,
    `type NodeOutput = ${schemaToTypeScript(output)};`,
    "interface NodeScriptOptions { [key: string]: any; logging: { log(...args: any[]): void }; }",
  ].join("\n");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noImplicitAny: false,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => file === mainFile || file === typesFile || originalFileExists(file);
  host.readFile = (file) =>
    file === mainFile ? source : file === typesFile ? types : originalReadFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (file === mainFile || file === typesFile) {
      return ts.createSourceFile(file, file === mainFile ? source : types, languageVersion, true);
    }
    return originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([mainFile, typesFile], options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => ![2307, 2792].includes(diagnostic.code));
  for (const diagnostic of diagnostics) {
    errors.push(issue(target, formatDiagnostic(diagnostic)));
  }

  const sourceFile = program.getSourceFile(mainFile);
  let defaultFunction: ts.FunctionLikeDeclaration | undefined;
  for (const statement of sourceFile?.statements ?? []) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      defaultFunction = statement;
    }
    if (
      ts.isExportAssignment(statement) &&
      (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression))
    ) {
      defaultFunction = statement.expression;
    }
  }
  if (!defaultFunction) {
    errors.push(issue(target, "must export a default node function."));
    return;
  }

  const inputProperties = isObject(inputs.properties) ? inputs.properties : {};
  const firstParameter = defaultFunction.parameters[0];
  if (firstParameter && !ts.isIdentifier(firstParameter.name)) {
    for (const inputName of bindingNames(firstParameter.name)) {
      if (!(inputName in inputProperties)) {
        errors.push(issue(target, `function destructures undeclared input \`${inputName}\`.`));
      }
    }
  }

  const checker = program.getTypeChecker();
  const visitReturns = (node: ts.Node) => {
    if (node !== defaultFunction && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const returnType = checker.getTypeAtLocation(node.expression);
      if (!typeMatchesSchema(returnType, output, checker)) {
        errors.push(
          issue(
            target,
            `return expression type \`${checker.typeToString(returnType)}\` is incompatible with output schema type \`${String(output.type)}\`.`,
          ),
        );
      }
    }
    ts.forEachChild(node, visitReturns);
  };
  if (defaultFunction.body) {
    visitReturns(defaultFunction.body);
  }
}

async function validateNodeAt(
  root: string,
  id: string,
  version: string,
): Promise<ValidationReport> {
  const target = `node:${id}@${version}`;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const dir = safeJoin(root, id, version);
  const [schemaRaw, inputsRaw, outputRaw, mainTs] = await Promise.all([
    readJson(path.join(dir, "schema.json")),
    readJson(path.join(dir, "inputs.json")),
    readJson(path.join(dir, "output.json")),
    readText(path.join(dir, "main.ts")),
    readJson(path.join(dir, "meta.json")),
  ]);
  const schema = asObject(schemaRaw, `${target}/schema.json`, errors);
  const inputs = validateJsonSchema(inputsRaw, `${target}/inputs.json`, errors);
  const output = validateJsonSchema(outputRaw, `${target}/output.json`, errors);

  if (schema.id !== id) errors.push(issue(target, `schema id must equal directory id \`${id}\`.`));
  if (schema.version !== version) {
    errors.push(issue(target, `schema version must equal directory version \`${version}\`.`));
  }
  if (!["script", "trigger"].includes(String(schema.type))) {
    errors.push(issue(target, "schema type must be `script` or `trigger`."));
  }
  const dependencies = asObject(schema.dependencies ?? {}, `${target}/schema.dependencies`, errors);
  for (const [name, dependencyVersion] of Object.entries(dependencies)) {
    if (typeof dependencyVersion !== "string" || dependencyVersion.length === 0) {
      errors.push(issue(target, `dependency \`${name}\` must have a non-empty version string.`));
    }
  }
  typeCheckMainTs(mainTs, inputs, output, `${target}/main.ts`, errors);
  return { valid: errors.length === 0, checked: [target], errors, warnings };
}

export async function validateNode(id: string, version?: string): Promise<ValidationReport> {
  if (!NODE_ID_RE.test(id)) throw new Error("Node id must be lowercase kebab-case.");
  if (version !== undefined && !SEMVER_RE.test(version)) throw new Error("Invalid node version.");
  const root = await nodesDir();
  const nodeDir = safeJoin(root, id);
  if (!(await pathExists(nodeDir))) throw new Error(`Node not found: ${id}`);
  const versions = (await listDirs(nodeDir)).filter((entry) => SEMVER_RE.test(entry));
  if (versions.length === 0) throw new Error(`Node ${id} has no semantic-version directories.`);
  versions.sort((a, b) => {
    const aa = a.split(".").map(Number);
    const bb = b.split(".").map(Number);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  });
  const selected = version ?? versions.at(-1);
  if (!selected || !versions.includes(selected)) {
    throw new Error(`Version ${version} not found for node ${id}.`);
  }
  return validateNodeAt(root, id, selected);
}

function referencedSchema(
  sourceId: string,
  pathParts: string[],
  workflowInputs: JsonObject,
  outputs: Map<string, JsonObject>,
): unknown {
  let current: unknown;
  if (sourceId === "inputs") current = workflowInputs;
  else current = outputs.get(sourceId);
  for (const part of pathParts) {
    if (!isObject(current)) return undefined;
    const properties = isObject(current.properties) ? current.properties : {};
    current = properties[part];
  }
  return current;
}

function schemasCompatible(source: unknown, destination: unknown): boolean {
  if (!isObject(source) || !isObject(destination)) return true;
  const sourceType = source.type;
  const destinationType = destination.type;
  if (typeof sourceType !== "string" || typeof destinationType !== "string") return true;
  return (
    sourceType === destinationType || (sourceType === "integer" && destinationType === "number")
  );
}

function literalMatchesSchema(value: unknown, schema: unknown): boolean {
  if (!isObject(schema) || typeof schema.type !== "string") return true;
  if (isObject(value) && ("_$keys_" in value || "_$expression_" in value)) return true;
  switch (schema.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      return true;
  }
}

function walkBindings(value: unknown, visit: (binding: JsonObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkBindings(item, visit);
    return;
  }
  if (!isObject(value)) return;
  if (Array.isArray(value._$keys_) || typeof value._$expression_ === "string") visit(value);
  for (const child of Object.values(value)) walkBindings(child, visit);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isCtxRootAccess(expression: ts.Expression): boolean {
  const candidate = unwrapParentheses(expression);
  if (ts.isPropertyAccessExpression(candidate)) {
    const owner = unwrapParentheses(candidate.expression);
    return ts.isIdentifier(owner) && owner.text === "ctx" && candidate.name.text === "root";
  }
  if (ts.isElementAccessExpression(candidate)) {
    const owner = unwrapParentheses(candidate.expression);
    return (
      ts.isIdentifier(owner) &&
      owner.text === "ctx" &&
      candidate.argumentExpression !== undefined &&
      ts.isStringLiteralLike(candidate.argumentExpression) &&
      candidate.argumentExpression.text === "root"
    );
  }
  return false;
}

function expressionNodeReferences(expression: string): string[] {
  const source = ts.createSourceFile(
    "buildship-expression.ts",
    `const __buildshipExpression = (${expression});`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const references = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      UUID_RE.test(node.argumentExpression.text) &&
      isCtxRootAccess(node.expression)
    ) {
      references.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...references];
}

function flattenWorkflowNodes(rawNodes: unknown[]): unknown[] {
  const flattened: unknown[] = [];
  const visitList = (list: unknown[]) => {
    for (const rawNode of list) {
      flattened.push(rawNode);
      if (!isObject(rawNode)) continue;
      for (const key of ["then", "else"]) {
        if (Array.isArray(rawNode[key])) visitList(rawNode[key]);
      }
      const nested = rawNode.nodes;
      if (Array.isArray(nested)) {
        visitList(nested);
      } else if (isObject(nested)) {
        for (const sequence of Object.values(nested)) {
          if (Array.isArray(sequence)) visitList(sequence);
        }
      }
      if (isObject(rawNode.conditionSequences)) {
        for (const sequence of Object.values(rawNode.conditionSequences)) {
          if (Array.isArray(sequence)) visitList(sequence);
        }
      }
    }
  };
  visitList(rawNodes);
  return flattened;
}

async function validateWorkflowAt(root: string, folder: string): Promise<ValidationReport> {
  const target = `workflow:${folder}`;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const dir = safeJoin(root, folder);
  const [schemaRaw, metaRaw, nodesRaw, inputsRaw, outputRaw, triggersRaw] = await Promise.all([
    readJson(path.join(dir, "schema.json")),
    readJson(path.join(dir, "meta.json")),
    readJson(path.join(dir, "nodes.json")),
    readJson(path.join(dir, "inputs.json")),
    readJson(path.join(dir, "output.json")),
    readJson(path.join(dir, "triggers.json")),
  ]);
  const schema = asObject(schemaRaw, `${target}/schema.json`, errors);
  const meta = asObject(metaRaw, `${target}/meta.json`, errors);
  const workflowInputs = validateJsonSchema(inputsRaw, `${target}/inputs.json`, errors);
  const workflowOutput = validateJsonSchema(outputRaw, `${target}/output.json`, errors);
  const nodes = Array.isArray(nodesRaw) ? nodesRaw : [];
  const flattenedNodes = flattenWorkflowNodes(nodes);
  const triggers = Array.isArray(triggersRaw) ? triggersRaw : [];
  if (!Array.isArray(nodesRaw)) errors.push(issue(`${target}/nodes.json`, "must be an array."));
  if (!Array.isArray(triggersRaw))
    errors.push(issue(`${target}/triggers.json`, "must be an array."));

  const ids = new Set<string>();
  const nodeById = new Map<string, JsonObject>();
  const triggerById = new Map<string, JsonObject>();
  const restTriggerIds = new Set<string>();
  const outputs = new Map<string, JsonObject>();
  let outputNodes = 0;
  for (const [index, rawNode] of flattenedNodes.entries()) {
    const node = asObject(rawNode, `${target}/nodes.json[${index}]`, errors);
    const id = typeof node.id === "string" ? node.id : "";
    if (!z.string().uuid().safeParse(id).success) {
      errors.push(issue(`${target}/nodes.json[${index}]`, "must have a UUID id."));
    } else if (ids.has(id)) {
      errors.push(issue(target, `duplicate node id \`${id}\`.`));
    } else {
      ids.add(id);
      nodeById.set(id, node);
    }
    if (!DEPLOYABLE_NODE_TYPES.has(String(node.type))) {
      errors.push(
        issue(target, `node ${id || index} has unsupported type \`${String(node.type)}\`.`),
      );
    }
    if (node.type === "library" || "nodeId" in node || "version" in node) {
      errors.push(
        issue(target, `node ${id || index} is a skeletal library reference, not deployable.`),
      );
    }
    if (node.type === "output") {
      outputNodes += 1;
      outputs.set(id, workflowOutput);
    } else if (node.type === "script") {
      const inputs = validateJsonSchema(node.inputs, `${target}/node:${id}.inputs`, errors);
      const output = validateJsonSchema(node.output, `${target}/node:${id}.output`, errors);
      outputs.set(id, output);
      if (typeof node.script !== "string" || node.script.trim().length === 0) {
        errors.push(issue(target, `script node ${id} is missing executable \`script\` source.`));
      } else {
        typeCheckMainTs(node.script, inputs, output, `${target}/node:${id}.script`, errors);
      }
    }
  }
  if (outputNodes === 0) {
    errors.push(issue(target, "must contain at least one Flow Output node."));
  }

  for (const [index, rawTrigger] of triggers.entries()) {
    const trigger = asObject(rawTrigger, `${target}/triggers.json[${index}]`, errors);
    const id = typeof trigger.id === "string" ? trigger.id : "";
    if (!z.string().uuid().safeParse(id).success) {
      errors.push(issue(target, `trigger ${index} must have a UUID id.`));
    } else if (ids.has(id)) {
      errors.push(issue(target, `trigger id \`${id}\` duplicates another node or trigger.`));
    } else {
      ids.add(id);
      triggerById.set(id, trigger);
    }
    const rawLibRef = isObject(trigger._libRef) ? trigger._libRef : {};
    const isRestTrigger =
      trigger.type === "http-v2" || rawLibRef.libNodeRefId === "@buildship/http-v2";
    if (isRestTrigger) {
      if (id) restTriggerIds.add(id);
      const libRef = asObject(trigger._libRef, `${target}/trigger:${id}._libRef`, errors);
      if (
        trigger.type !== "http-v2" ||
        libRef.libNodeRefId !== "@buildship/http-v2" ||
        typeof libRef.integrity !== "string" ||
        typeof libRef.src !== "string"
      ) {
        errors.push(issue(target, `trigger ${id || index} is not a complete REST v2 definition.`));
      }
      if (!("response" in trigger)) {
        errors.push(issue(target, `REST trigger ${id || index} is missing \`response\`.`));
      }
    }
    for (const requiredField of [
      "config",
      "data",
      "dependencies",
      "lifeCycleFunctions",
      "meta",
      "script",
    ]) {
      if (!(requiredField in trigger)) {
        errors.push(issue(target, `trigger ${id || index} is missing \`${requiredField}\`.`));
      }
    }
    if (typeof trigger.script !== "string" || !trigger.script.includes("onExecution")) {
      errors.push(issue(target, `trigger ${id || index} lacks an executable onExecution handler.`));
    }
    const data = isObject(trigger.data) ? trigger.data : {};
    outputs.set(id, data);
  }

  const nodeValues = asObject(schema.nodeValues, `${target}/schema.nodeValues`, errors);
  for (const id of ids) {
    if (!(id in nodeValues))
      errors.push(issue(target, `schema.nodeValues is missing id \`${id}\`.`));
  }
  for (const valueId of Object.keys(nodeValues)) {
    if (!ids.has(valueId)) {
      errors.push(issue(target, `schema.nodeValues references unknown node id \`${valueId}\`.`));
    }
  }
  for (const [triggerId, trigger] of triggerById) {
    if (!restTriggerIds.has(triggerId)) continue;
    const values = isObject(nodeValues[triggerId]) ? nodeValues[triggerId] : {};
    const config = isObject(trigger.config) ? trigger.config : {};
    const properties = isObject(config.properties) ? config.properties : {};
    for (const key of ["path", "method", "requestContentType"]) {
      if (!(`config.${key}` in values)) {
        errors.push(issue(target, `REST trigger ${triggerId} is missing config value \`${key}\`.`));
      }
      const property = isObject(properties[key]) ? properties[key] : {};
      if (
        `config.${key}` in values &&
        property.default !== undefined &&
        values[`config.${key}`] !== property.default
      ) {
        errors.push(
          issue(target, `REST trigger ${triggerId} has inconsistent \`${key}\` defaults.`),
        );
      }
    }
    const restPath = values["config.path"];
    if (typeof restPath !== "string" || !/^\/[^\s?#]*$/.test(restPath)) {
      errors.push(issue(target, `REST trigger ${triggerId} has an invalid endpoint path.`));
    }
    for (const responseKey of ["outputs.body", "outputs.cacheMaxAge", "outputs.status"]) {
      if (!(responseKey in values)) {
        errors.push(
          issue(target, `REST trigger ${triggerId} is missing \`${responseKey}\` mapping.`),
        );
      }
    }
  }
  for (const [nodeId, node] of nodeById) {
    if (node.type !== "script" || !isObject(node.inputs)) continue;
    const properties = isObject(node.inputs.properties) ? node.inputs.properties : {};
    const values = isObject(nodeValues[nodeId]) ? nodeValues[nodeId] : {};
    const required = Array.isArray(node.inputs.required)
      ? node.inputs.required.filter((key): key is string => typeof key === "string")
      : [];
    for (const inputName of required) {
      const property = isObject(properties[inputName]) ? properties[inputName] : {};
      if (!(inputName in values) && property.default === undefined) {
        errors.push(
          issue(target, `required input \`${nodeId}.${inputName}\` has no binding or default.`),
        );
      }
    }
    for (const [inputName, value] of Object.entries(values)) {
      if (inputName in properties && !literalMatchesSchema(value, properties[inputName])) {
        errors.push(
          issue(
            target,
            `literal value for ${nodeId}.${inputName} is incompatible with its schema.`,
          ),
        );
      }
    }
  }

  const labels = asObject(meta.nodeIdToLabel, `${target}/meta.nodeIdToLabel`, errors);
  for (const labelId of Object.keys(labels)) {
    if (!ids.has(labelId)) {
      errors.push(issue(target, `meta.nodeIdToLabel references unknown id \`${labelId}\`.`));
    }
  }

  const inputProperties = isObject(workflowInputs.properties) ? workflowInputs.properties : {};
  for (const [destinationId, values] of Object.entries(nodeValues)) {
    const destination = nodeById.get(destinationId);
    const destinationInputs =
      destination?.type === "output"
        ? workflowOutput
        : isObject(destination?.inputs)
          ? destination.inputs
          : {};
    const destinationProperties = isObject(destinationInputs.properties)
      ? destinationInputs.properties
      : {};
    const valueObject = isObject(values) ? values : {};
    for (const [destinationKey, bindingValue] of Object.entries(valueObject)) {
      walkBindings(bindingValue, (binding) => {
        if (Array.isArray(binding._$keys_)) {
          const keys = binding._$keys_.filter((key): key is string => typeof key === "string");
          const [sourceId, ...sourcePath] = keys;
          if (!sourceId || sourceId === "state" || sourceId === "output") return;
          if (sourceId === "inputs" && sourcePath[0] && !(sourcePath[0] in inputProperties)) {
            errors.push(
              issue(target, `binding references missing workflow input \`${sourcePath[0]}\`.`),
            );
            return;
          }
          if (sourceId !== "inputs" && !ids.has(sourceId)) {
            errors.push(issue(target, `binding references unknown node id \`${sourceId}\`.`));
            return;
          }
          const sourceSchema = referencedSchema(sourceId, sourcePath, workflowInputs, outputs);
          const destinationSchema = destinationProperties[destinationKey];
          if (!schemasCompatible(sourceSchema, destinationSchema)) {
            errors.push(
              issue(
                target,
                `incompatible binding for ${destinationId}.${destinationKey}: source and input schema types differ.`,
              ),
            );
          }
        }
        if (typeof binding._$expression_ === "string") {
          if (binding.type !== "text") {
            const transpiled = ts.transpileModule(
              `const __buildshipExpression = (${binding._$expression_});`,
              {
                compilerOptions: {
                  target: ts.ScriptTarget.ES2022,
                  module: ts.ModuleKind.NodeNext,
                },
                reportDiagnostics: true,
              },
            );
            for (const diagnostic of transpiled.diagnostics ?? []) {
              if (diagnostic.category === ts.DiagnosticCategory.Error) {
                errors.push(
                  issue(target, `invalid BuildShip expression: ${formatDiagnostic(diagnostic)}`),
                );
              }
            }
          }
          for (const reference of expressionNodeReferences(binding._$expression_)) {
            if (!ids.has(reference)) {
              errors.push(issue(target, `expression references unknown node id \`${reference}\`.`));
            }
          }
        }
      });
    }
  }

  return { valid: errors.length === 0, checked: [target], errors, warnings };
}

export async function validateWorkflow(folder: string): Promise<ValidationReport> {
  if (!WORKFLOW_FOLDER_RE.test(folder)) {
    throw new Error("Workflow folder must be a traversal-safe BuildShip slug.");
  }
  const root = await workflowsDir();
  const dir = safeJoin(root, folder);
  if (!(await pathExists(dir))) throw new Error(`Workflow not found: ${folder}`);
  return validateWorkflowAt(root, folder);
}

function mergeReports(reports: ValidationReport[]): ValidationReport {
  const errors = reports.flatMap((report) => report.errors);
  return {
    valid: errors.length === 0,
    checked: reports.flatMap((report) => report.checked),
    errors,
    warnings: reports.flatMap((report) => report.warnings),
  };
}

export const ValidateDeploymentSchema = z
  .object({
    node: z
      .object({
        id: z.string().regex(NODE_ID_RE),
        version: z.string().regex(SEMVER_RE).optional(),
      })
      .optional(),
    workflow: z.object({ folder: z.string().regex(WORKFLOW_FOLDER_RE) }).optional(),
    all: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const targets =
      Number(Boolean(value.node)) + Number(Boolean(value.workflow)) + Number(value.all);
    if (targets !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify exactly one of `node`, `workflow`, or `all: true`.",
      });
    }
  });

export async function validateDeployment(raw: unknown): Promise<ValidationReport> {
  const input = ValidateDeploymentSchema.parse(raw);
  if (input.node) return validateNode(input.node.id, input.node.version);
  if (input.workflow) return validateWorkflow(input.workflow.folder);

  const reports: ValidationReport[] = [];
  const nodeRoot = await nodesDir();
  for (const id of await listDirs(nodeRoot)) {
    if (!NODE_ID_RE.test(id)) {
      reports.push({
        valid: false,
        checked: [`node:${id}`],
        errors: [issue(`node:${id}`, "directory name is not a safe node slug.")],
        warnings: [],
      });
      continue;
    }
    for (const version of await listDirs(safeJoin(nodeRoot, id))) {
      if (!SEMVER_RE.test(version)) {
        reports.push({
          valid: false,
          checked: [`node:${id}@${version}`],
          errors: [issue(`node:${id}@${version}`, "directory name is not semantic versioning.")],
          warnings: [],
        });
      } else {
        reports.push(await validateNodeAt(nodeRoot, id, version));
      }
    }
  }
  const workflowRoot = await workflowsDir();
  for (const folder of await listDirs(workflowRoot)) {
    if (!WORKFLOW_FOLDER_RE.test(folder)) {
      reports.push({
        valid: false,
        checked: [`workflow:${folder}`],
        errors: [issue(`workflow:${folder}`, "directory name is not a safe workflow slug.")],
        warnings: [],
      });
    } else {
      reports.push(await validateWorkflowAt(workflowRoot, folder));
    }
  }
  return mergeReports(reports);
}

export function assertDeploymentValid(report: ValidationReport): void {
  if (!report.valid) {
    const details = report.errors.map(({ target, message }) => `${target}: ${message}`).join("; ");
    throw new Error(`BuildShip deployment validation failed: ${details}`);
  }
}

export async function validateChangedBuildshipPaths(paths: string[]): Promise<ValidationReport> {
  const reports: ValidationReport[] = [];
  const targets = new Set<string>();
  for (const changedPath of paths) {
    const normalized = changedPath.replaceAll("\\", "/");
    const nodeMatch = normalized.match(/^nodes\/([^/]+)\/([^/]+)\//);
    if (nodeMatch) targets.add(`node:${nodeMatch[1]}@${nodeMatch[2]}`);
    const workflowMatch = normalized.match(/^workflows\/([^/]+)\//);
    if (workflowMatch) targets.add(`workflow:${workflowMatch[1]}`);
  }
  for (const target of targets) {
    if (target.startsWith("node:")) {
      const [id, version] = target.slice("node:".length).split("@");
      const dir = safeJoin(await nodesDir(), id, version);
      if (await pathExists(dir)) reports.push(await validateNode(id, version));
    } else {
      const folder = target.slice("workflow:".length);
      const dir = safeJoin(await workflowsDir(), folder);
      if (await pathExists(dir)) reports.push(await validateWorkflow(folder));
    }
  }
  return mergeReports(reports);
}
