import { CORE_VERSION } from "@konogame/infrastructure/contracts";
import { ApiMethod, type ApiRoute } from "./route.ts";

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        tag: { type: "string" },
        message: { type: "string" },
        code: { type: "string" },
        issues: {}
      },
      required: ["tag", "message"]
    }
  },
  required: ["error"]
};

export function createOpenApiDocument(routes: readonly ApiRoute[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, object> = {};
  function schemaReference(name: string, schema: object = {}) {
    // Owner schemas keep their local definitions when embedded in the API document.
    const projected = JSON.parse(JSON.stringify(schema), (key, value: unknown) =>
      key === "$ref" && typeof value === "string" && value.startsWith("#/")
        ? `#/components/schemas/${name}/${value.slice(2)}`
        : value
    ) as object;
    schemas[name] = projected;
    return { $ref: `#/components/schemas/${name}` };
  }
  for (const route of routes) {
    const responseReference = schemaReference(`${route.operationId}Response`, route.responseSchema);
    const statusEntries = Object.entries(route.resultStatusCodes ?? {});
    const successSchema = statusEntries.length
      ? {
          allOf: [
            responseReference,
            {
              not: {
                type: "object",
                properties: { status: { enum: statusEntries.map(([status]) => status) } },
                required: ["status"]
              }
            }
          ]
        }
      : responseReference;
    const failureSchema = (code: string) => {
      const statuses = statusEntries
        .filter(([, status]) => String(status) === code)
        .map(([status]) => status);
      return statuses.length
        ? {
            anyOf: [
              errorSchema,
              {
                allOf: [
                  responseReference,
                  {
                    type: "object",
                    properties: { status: { enum: statuses } },
                    required: ["status"]
                  }
                ]
              }
            ]
          }
        : errorSchema;
    };
    const parameters = [
      ...Array.from(route.path.matchAll(/\{([^}]+)\}/g), (match) => {
        const declaration = route.pathParameters?.find((parameter) => parameter.name === match[1]);
        return {
          name: match[1],
          in: "path",
          required: true,
          schema: { type: "string" },
          ...declaration
        };
      }),
      ...(route.queryParameters ?? []).map((parameter) => ({ ...parameter, in: "query" }))
    ];
    paths[route.path] ??= {};
    paths[route.path]![route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      ...(parameters.length ? { parameters } : {}),
      ...(route.method === ApiMethod.Post
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: schemaReference(`${route.operationId}Request`, route.requestSchema)
                }
              }
            }
          }
        : {}),
      responses: {
        "200": {
          description: "Operation result",
          content: {
            "application/json": {
              schema: successSchema
            }
          }
        },
        ...Object.fromEntries(
          [
            ["400", "Invalid request"],
            ["403", "Forbidden Origin or Host"],
            ["404", "Resource not found"],
            ["409", "Conflict or recovery required"],
            ["413", "Request body exceeds the limit"],
            ["415", "JSON content type required"],
            ["422", "Operation refused"],
            ["500", "Internal server error"]
          ].map(([status, description]) => [
            status,
            {
              description,
              content: {
                "application/json": {
                  schema: failureSchema(status!)
                }
              }
            }
          ])
        )
      }
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Konogame local daemon API", version: CORE_VERSION },
    servers: [{ url: "/" }],
    paths,
    components: { schemas }
  };
}
