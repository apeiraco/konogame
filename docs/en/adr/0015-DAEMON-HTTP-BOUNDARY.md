# ADR 0015 · Daemon HTTP boundary

> Presentation update: WebUI owns the offline reference page and the daemon owns the JSON specification. See the [WebUI guide](../010-WEBUI.md).

Accepted on 2026-11-03.

## Decision

Use Hono with its Node adapter to expose the existing application services. The CLI and daemon compose the same owner Layers. Resource ownership, cancellation and recovery stay in the Effect workflows. HTTP routes translate requests to service inputs and expose the outcomes in an OpenAPI document. The HTML reference and JSON specification are available from the local server.

## Why this fits Konogame

Both Hono and Elysia support Node and TypeScript. Elysia offers integrated validation and an OpenAPI plugin, which are attractive when the HTTP application's schema is the starting point. Here the public records and intents already have ArkType schemas, while Effect 4.0.6 owns dependency injection and request lifetimes. We chose Hono's Fetch-style boundary and Node adapter so the HTTP layer can reuse these decisions. This choice makes no throughput claim. [Hono Node.js](https://hono.dev/docs/getting-started/nodejs) · [Hono validation](https://hono.dev/docs/guides/validation) · [Elysia Node.js](https://elysiajs.com/integrations/node) · [Elysia OpenAPI](https://elysiajs.com/plugins/openapi)

The pinned Effect package also contains `effect/http-api`. Its endpoint definitions would be a natural fit for a service whose wire contracts are authored in Effect Schema. Adopting it here would require deciding how those definitions relate to the existing ArkType contracts.

## Scope

The daemon serves a local client operating with the daemon user's filesystem access. A Workspace root or save source directory in a request refers to the daemon host. Operations complete within the request. Remote accounts, durable jobs and unattended restore require separate designs.

[English](0015-DAEMON-HTTP-BOUNDARY.md) | [中文](../../zh/adr/0015-DAEMON-HTTP-BOUNDARY.md)
