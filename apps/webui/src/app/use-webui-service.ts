import { useRouter } from "@tanstack/react-router";
import { Context } from "effect";
import { type WebUIAppContext, type WebUIServiceKeys } from "./webui-app-context.ts";

export function useWebUIAppContext(): WebUIAppContext {
  return useRouter().options.context.appContext;
}

/** Router context transports one native Effect graph; services own their state. */
export function useWebUIService<I extends WebUIServiceKeys, S>(tag: Context.Key<I, S>): S {
  return Context.get(useWebUIAppContext().context, tag);
}
