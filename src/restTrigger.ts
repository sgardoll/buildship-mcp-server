interface RestTriggerConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  requestContentType: "application/json" | "application/x-www-form-urlencoded" | "text/plain";
}

const METHOD_OPTIONS = ["POST", "GET", "PUT", "DELETE", "PATCH"].map((value) => ({
  label: value,
  value,
}));
const CONTENT_TYPE_OPTIONS = [
  { label: "JSON (application/json)", value: "application/json" },
  { label: "Form (application/x-www-form-urlencoded)", value: "application/x-www-form-urlencoded" },
  { label: "Text (text/plain)", value: "text/plain" },
];
const STATUS_OPTIONS = [
  ["OK (200)", "200"],
  ["Created (201)", "201"],
  ["Accepted (202)", "202"],
  ["No Content (204)", "204"],
  ["Bad Request (400)", "400"],
  ["Unauthorized (401)", "401"],
  ["Forbidden (403)", "403"],
  ["Not Found (404)", "404"],
  ["Too Many Requests (429)", "429"],
  ["Internal Server Error (500)", "500"],
].map(([label, value]) => ({ label, value }));

const REST_TRIGGER_SCRIPT = `import parser from "co-body";

const onExecution = async (
  { method, requestContentType },
  { nodeReq, request }
) => {
  let body;
  if (method !== "GET") {
    const limit = process.env?.PROJECT_PLAN === "FREE" ? "1MB" : "32MB";
    switch (requestContentType) {
      case "text/plain":
        body = await parser.text(nodeReq, { limit });
        break;
      case "application/x-www-form-urlencoded":
        body = await parser.form(nodeReq, { limit });
        break;
      case "application/json":
        body = await parser.json(nodeReq, { limit });
        break;
      default:
        break;
    }
  }
  return {
    query: request.query,
    headers: request.headers,
    body: body ?? {},
    params: request.params,
    requestPath: request.path,
  };
};

export default { onExecution };
`;

/** BuildShip's complete, deployable REST API Trigger v2 serialization. */
export function buildRestTrigger(triggerId: string, cfg: RestTriggerConfig) {
  const sectionId = "section_e5935beb_b40e_437c_b484_66fa67eccbfa";
  const description =
    "Create an API / HTTP endpoint as the trigger or starting point for your workflow.";
  return {
    _libRef: {
      integrity: "v3:74dcc0ee687d94ecee64573d5ddb0544",
      isDirty: false,
      libNodeRefId: "@buildship/http-v2",
      libType: "public",
      src: "https://storage.googleapis.com/buildship-library-us-central1/triggers/@buildship/http-v2/2.0.2/__verify.cjs",
      version: "2.0.2",
    },
    config: {
      properties: {
        method: {
          buildship: {
            defaultExpressionType: "text",
            index: 1,
            options: METHOD_OPTIONS,
            sensitive: false,
          },
          default: cfg.method,
          description: "HTTP method",
          enum: METHOD_OPTIONS.map(({ value }) => value),
          title: "Method",
          type: "string",
        },
        path: {
          buildship: { index: 0, sensitive: false },
          default: cfg.path,
          description: "Path of the endpoint",
          pattern: "^\\/[^\\s?#]*$",
          properties: {},
          title: "Path",
          type: "string",
        },
        requestContentType: {
          buildship: { index: 2.2, options: CONTENT_TYPE_OPTIONS, sensitive: false },
          default: cfg.requestContentType,
          enum: CONTENT_TYPE_OPTIONS.map(({ value }) => value),
          properties: {},
          title: "Request Content Type",
          type: "string",
        },
      },
      required: ["path", "method"],
      sections: {
        [sectionId]: {
          buildship: { index: 2 },
          title: "Advanced Options",
          type: "section",
        },
      },
      structure: [
        { depth: 0, id: "path", index: 0, parentId: null },
        { depth: 0, id: "method", index: 1, parentId: null },
        {
          children: [
            {
              depth: 1,
              id: "requestContentType",
              index: 0,
              parentId: sectionId,
            },
          ],
          depth: 0,
          id: sectionId,
          index: 2,
          parentId: null,
        },
      ],
      type: "object",
    },
    data: {
      buildship: {},
      description: "HTTP request data",
      properties: {
        body: {
          buildship: { index: 0, sensitive: true },
          default: {},
          properties: {},
          title: "Body",
          type: "object",
        },
        headers: {
          buildship: { index: 1, sensitive: true },
          default: {},
          properties: {
            authorization: {
              buildship: { index: 0 },
              title: "authorization",
              type: "string",
            },
          },
          title: "Headers",
          type: "object",
        },
        query: {
          buildship: { index: 2 },
          properties: {},
          title: "Query",
          type: "object",
        },
        params: {
          buildship: { index: 3 },
          properties: {},
          title: "Params",
          type: "object",
        },
        requestPath: {
          buildship: { index: 4 },
          title: "Request Path",
          type: "string",
        },
      },
      required: ["body"],
      title: "Request",
      type: "object",
    },
    defaultValues: {
      inputs:
        "{ _$expression_: 'ctx?.[\"root\"]?.[\"' + props.triggerId + '\"]?.[\"' + (props.method === 'GET' ? 'query' : 'body') + '\"].' + props.inputKey }",
      path: "'/' + props.wfName + '-' + props.triggerId.split('-').slice(-1).join('')",
    },
    dependencies: { "co-body": "6.2.0" },
    description,
    id: triggerId,
    label: "REST API Call",
    lifeCycleFunctions: ["onExecution"],
    meta: {
      description,
      fileUploadLimit: false,
      icon: { svg: "", type: "SVG" },
      id: "http-v2",
      name: "REST API Call",
      payloadLimit: true,
    },
    response: {
      properties: {
        body: {
          buildship: { index: 1, sensitive: false },
          default: { _$keys_: ["output"] },
          properties: {},
          title: "Response Body",
          type: "object",
        },
        cacheMaxAge: {
          buildship: { index: 2, sensitive: false },
          default: 0,
          title: "Cache Time",
          type: "number",
        },
        status: {
          buildship: { index: 0, options: STATUS_OPTIONS },
          default: "200",
          enum: STATUS_OPTIONS.map(({ value }) => value),
          title: "Status code",
          type: "string",
        },
      },
      required: ["body"],
      sections: {},
      structure: [
        { depth: 0, id: "body", index: 1, parentId: null },
        { depth: 0, id: "status", index: 0, parentId: null },
        { depth: 0, id: "cacheMaxAge", index: 2, parentId: null },
      ],
      title: "Response",
      type: "object",
    },
    script: REST_TRIGGER_SCRIPT,
    type: "http-v2",
  };
}
