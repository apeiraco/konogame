import { QueryClient } from "@tanstack/react-query";
import { Context, Effect, Exit, Layer, Option, Scope } from "effect";
import {
  DISCOVERY_REVIEW,
  discoveryReviewLayer,
  REVIEW_CACHE
} from "../game/discovery/discovery-review.service.ts";
import { LIBRARY_SERVICE, provideLibrary } from "../game/library/library.service.ts";
import { runUiEffect } from "../infrastructure/effect/run-ui-effect.ts";
import { DAEMON_HTTP, provideDaemonHttp } from "../infrastructure/http/daemon-http.ts";
import {
  LOCALE,
  LOCALE_PREFERENCES,
  localeLayer,
  provideLocalePreferences
} from "../infrastructure/i18n/locale.service.ts";
import { workspaceKeys } from "../workspace/workspace.query-keys.ts";
import { WORKSPACE_OPEN, workspaceOpenLayer } from "../workspace/workspace-open.service.ts";
import { provideWorkspaceQuery, WORKSPACE_QUERY } from "../workspace/workspace-query.service.ts";
import {
  provideSessionStorage,
  SESSION_STORAGE,
  WORKSPACE_SESSION,
  workspaceSessionLayer
} from "../workspace/workspace-session.service.ts";

export type WebUIServiceKeys =
  | DAEMON_HTTP
  | WORKSPACE_QUERY
  | WORKSPACE_SESSION
  | WORKSPACE_OPEN
  | LIBRARY_SERVICE
  | DISCOVERY_REVIEW
  | REVIEW_CACHE
  | SESSION_STORAGE
  | LOCALE
  | LOCALE_PREFERENCES
  | Scope.Scope;
/** Each router owns one service graph and the resources acquired by its Layers. */
export class WebUIAppContext implements AsyncDisposable {
  constructor(
    readonly context: Context.Context<WebUIServiceKeys>,
    readonly queryClient: QueryClient,
    private readonly lifetime: AsyncDisposableStack
  ) {}

  hydrate(): Promise<void> {
    return runUiEffect(
      Effect.all([
        Context.get(this.context, WORKSPACE_SESSION).hydrate,
        Context.get(this.context, LOCALE).hydrate
      ]).pipe(Effect.asVoid)
    );
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.lifetime.disposeAsync();
  }
}

export interface WebUIAppOptions {
  readonly overrides?: Layer.Layer<never>;
  readonly queryClient?: QueryClient;
}

function ownerLayer<I, S, E, R>(
  overrides: Context.Context<never>,
  tag: Context.Key<I, S>,
  fallback: Layer.Layer<I, E, R>
): Layer.Layer<I, E, R> {
  const replacement = Context.getOption(overrides, tag);
  return Option.isSome(replacement) ? Layer.succeed(tag, replacement.value) : fallback;
}

export async function createWebUIAppContext(
  options: WebUIAppOptions = {}
): Promise<WebUIAppContext> {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } }
    });
  await using lifetime = new AsyncDisposableStack();
  lifetime.defer(() => queryClient.clear());
  const scope = Scope.makeUnsafe();
  lifetime.defer(() => runUiEffect(Scope.close(scope, Exit.void)));
  lifetime.defer(() => queryClient.cancelQueries());
  // Build each replacement once, and skip its default owner Layer entirely.
  const overrides = await runUiEffect(
    Layer.buildWithScope(options.overrides ?? Layer.empty, scope)
  );
  const roots = Layer.mergeAll(
    ownerLayer(
      overrides,
      LOCALE_PREFERENCES,
      provideLocalePreferences({
        read: () => undefined,
        write: () => {}
      })
    ),
    ownerLayer(overrides, DAEMON_HTTP, provideDaemonHttp(globalThis.fetch)),
    ownerLayer(
      overrides,
      SESSION_STORAGE,
      provideSessionStorage(() => undefined)
    ),
    ownerLayer(
      overrides,
      REVIEW_CACHE,
      Layer.succeed(REVIEW_CACHE, {
        invalidate: (root) =>
          Effect.promise(() =>
            queryClient.invalidateQueries({ queryKey: workspaceKeys.workspace(root) })
          )
      })
    )
  );
  const session = ownerLayer(overrides, WORKSPACE_SESSION, workspaceSessionLayer);
  const dependencies = Layer.merge(session, ownerLayer(overrides, LOCALE, localeLayer)).pipe(
    Layer.provideMerge(roots)
  );
  const layer = Layer.mergeAll(
    ownerLayer(overrides, LIBRARY_SERVICE, provideLibrary()),
    ownerLayer(overrides, WORKSPACE_QUERY, provideWorkspaceQuery()),
    ownerLayer(overrides, DISCOVERY_REVIEW, discoveryReviewLayer)
  ).pipe(Layer.provideMerge(dependencies));
  const opener = ownerLayer(overrides, WORKSPACE_OPEN, workspaceOpenLayer).pipe(
    Layer.provideMerge(layer)
  );
  const context = await runUiEffect(Layer.buildWithScope(opener, scope));
  return new WebUIAppContext(
    Context.add(context, Scope.Scope, scope),
    queryClient,
    lifetime.move()
  );
}
