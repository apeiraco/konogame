import { effect } from "@preact/signals-core";
import { Context, Layer } from "effect";
import { expect, test, vi } from "vitest";
import { createWebUIAppContext } from "../../../app/webui-app-context.ts";
import { runUiEffect } from "../../effect/run-ui-effect.ts";
import {
  defaultLanguage,
  InterfaceLanguage,
  LOCALE,
  provideLocalePreferences
} from "../locale.service.ts";

test("keeps SSR locale deterministic, restores preferences only on hydration, and isolates routers", async () => {
  const read = vi.fn(() => InterfaceLanguage.English);
  const write = vi.fn();
  await using first = await createWebUIAppContext({
    overrides: provideLocalePreferences({ read, write })
  });
  await using second = await createWebUIAppContext();
  const locale = Context.get(first.context, LOCALE);
  const independent = Context.get(second.context, LOCALE);
  expect(locale.language.peek()).toBe(defaultLanguage);
  expect(locale.isHydrated.peek()).toBe(false);
  expect(locale.translator.peek()("shell:library")).toBe("游戏库");
  expect(read).not.toHaveBeenCalled();

  const translations: string[] = [];
  const stop = effect(() => {
    translations.push(locale.translator.value("shell:library"));
  });
  try {
    await first.hydrate();
    expect(locale.language.peek()).toBe(InterfaceLanguage.English);
    expect(locale.isHydrated.peek()).toBe(true);
    expect(locale.translator.peek()("library:gamesFiltered", { count: 1, visible: 1 })).toBe(
      "Showing 1 of 1 game"
    );
    expect(locale.translator.peek()("library:gamesFiltered", { count: 2, visible: 1 })).toBe(
      "Showing 1 of 2 games"
    );
    expect(locale.translator.peek()("library:gamesFiltered", { count: 2000, visible: 1200 })).toBe(
      "Showing 1,200 of 2,000 games"
    );
    expect(independent.language.peek()).toBe(defaultLanguage);
    expect(independent.isHydrated.peek()).toBe(false);
    await runUiEffect(locale.setLanguage(InterfaceLanguage.Chinese));
    expect(write).toHaveBeenCalledExactlyOnceWith(InterfaceLanguage.Chinese);
    expect(translations).toEqual(["游戏库", "Library", "游戏库"]);
    await first.hydrate();
    expect(read).toHaveBeenCalledOnce();
  } finally {
    stop();
  }
});

test.each(["unsupported", "denied"])("keeps locale usable when storage is %s", async (state) => {
  await using app = await createWebUIAppContext({
    overrides: provideLocalePreferences({
      read: () => {
        if (state === "denied") {
          throw new Error("storage denied");
        }
        return "fr";
      },
      write: () => {
        throw new Error("storage denied");
      }
    })
  });
  await app.hydrate();
  const locale = Context.get(app.context, LOCALE);
  expect(locale.language.peek()).toBe(defaultLanguage);
  await runUiEffect(locale.setLanguage(InterfaceLanguage.English));
  expect(locale.translator.peek()("common:error.network")).toBe(
    "Cannot reach the local daemon. Check that it is still running."
  );
});

test("honors a root locale override without constructing its default preference dependency", async () => {
  await using owner = await createWebUIAppContext();
  const locale = Context.get(owner.context, LOCALE);
  await using app = await createWebUIAppContext({
    overrides: Layer.merge(
      Layer.succeed(LOCALE, locale),
      provideLocalePreferences({
        read: () => {
          throw new Error("unused preference");
        },
        write: () => {}
      })
    )
  });
  await app.hydrate();
  expect(Context.get(app.context, LOCALE)).toBe(locale);
});
