import { type GAME_ADMISSION } from "@konogame/game/admission";
import {
  type ADAPTER_RESOLUTION_PLANNER,
  type EXTENSION_CATALOG,
  type EXTENSION_REGISTRY
} from "@konogame/infrastructure";
import { type SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { type WORKSPACE_BROWSE } from "@konogame/workspace/browse";
import { type WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Data, type Effect, type Scope } from "effect";
import { type DAEMON_ARTIFACT_INPUT } from "../artifact-input.ts";

export type ApiServices =
  | ADAPTER_RESOLUTION_PLANNER
  | EXTENSION_CATALOG
  | EXTENSION_REGISTRY
  | WORKSPACE_MANAGEMENT
  | WORKSPACE_BROWSE
  | GAME_ADMISSION
  | SAVE_STORE_WORKFLOW
  | DAEMON_ARTIFACT_INPUT;

export interface ApiRequest {
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly params: Readonly<Record<string, string>>;
}

export const ApiMethod = { Get: "GET", Post: "POST" } as const;
export type ApiMethod = (typeof ApiMethod)[keyof typeof ApiMethod];

export const ApiStatus = {
  Ok: 200,
  BadRequest: 400,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  PayloadTooLarge: 413,
  UnsupportedMediaType: 415,
  Unprocessable: 422,
  InternalError: 500
} as const;
export type ApiStatus = (typeof ApiStatus)[keyof typeof ApiStatus];

export interface ApiRoute {
  readonly method: ApiMethod;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly requestSchema?: object;
  readonly responseSchema?: object;
  readonly resultStatusCodes?: Readonly<Record<string, ApiStatus>>;
  readonly pathParameters?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly schema?: object;
  }[];
  readonly queryParameters?: readonly {
    readonly name: string;
    readonly required?: boolean;
    readonly description?: string;
    readonly schema?: object;
  }[];
  readonly handler: (
    input: ApiRequest
  ) => Effect.Effect<unknown, unknown, ApiServices | Scope.Scope>;
}

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: ApiStatus;
  readonly message: string;
  readonly issues?: unknown;
}> {
  static badRequest(message: string, issues?: unknown) {
    return new ApiError({ status: ApiStatus.BadRequest, message, issues });
  }

  static conflict(message: string, issues?: unknown) {
    return new ApiError({ status: ApiStatus.Conflict, message, issues });
  }

  static notFound(message: string) {
    return new ApiError({ status: ApiStatus.NotFound, message });
  }
}
