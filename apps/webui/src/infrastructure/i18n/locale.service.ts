import { batch, type ReadonlySignal, type Signal, signal } from "@preact/signals-core";
import { Context, Effect, Layer } from "effect";
import { createInstance, type i18n, type TFunction } from "i18next";
import { resources } from "./resources.ts";

export const InterfaceLanguage = { English: "en", Chinese: "zh-CN" } as const;
export type InterfaceLanguage = (typeof InterfaceLanguage)[keyof typeof InterfaceLanguage];
export const defaultLanguage = InterfaceLanguage.Chinese;
export const interfaceLanguageKey = "konogame.interface-language";
const namespaces = ["common", "shell", "workspace", "developer", "library", "discovery"] as const;
export type Translator = TFunction<typeof namespaces>;

export interface LocalePreferences {
  readonly read: () => string | null | undefined;
  readonly write: (language: InterfaceLanguage) => void;
}

export class LOCALE_PREFERENCES extends Context.Service<LOCALE_PREFERENCES, LocalePreferences>()(
  "webui/LocalePreferences"
) {}

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return Object.values(InterfaceLanguage).some((language) => language === value);
}

/** One router owns an independent i18next instance and observable locale selection. */
export class LocaleService {
  private readonly selected = signal<InterfaceLanguage>(defaultLanguage);
  private readonly hydrated = signal(false);
  private readonly translate: Signal<Translator>;
  readonly language: ReadonlySignal<InterfaceLanguage> = this.selected;
  readonly isHydrated: ReadonlySignal<boolean> = this.hydrated;
  readonly translator: ReadonlySignal<Translator>;

  constructor(
    private readonly engine: i18n,
    private readonly preferences: LocalePreferences
  ) {
    this.translate = signal(engine.getFixedT(defaultLanguage, namespaces));
    this.translator = this.translate;
  }

  readonly hydrate = Effect.sync(() => {
    if (this.hydrated.peek()) {
      return;
    }
    let language: InterfaceLanguage = defaultLanguage;
    try {
      const saved = this.preferences.read();
      if (isInterfaceLanguage(saved)) {
        language = saved;
      }
    } catch {
      // Browser storage denial does not prevent this page from changing language.
    }
    batch(() => {
      this.select(language);
      this.hydrated.value = true;
    });
  });

  setLanguage(language: InterfaceLanguage): Effect.Effect<void> {
    return Effect.sync(() => {
      this.select(language);
      try {
        this.preferences.write(language);
      } catch {
        // Persistence is optional; this page keeps its selected language.
      }
    });
  }

  private select(language: InterfaceLanguage): void {
    batch(() => {
      this.selected.value = language;
      this.translate.value = this.engine.getFixedT(language, namespaces);
    });
  }
}

export class LOCALE extends Context.Service<LOCALE, LocaleService>()("webui/Locale") {}

export const localeLayer = Layer.effect(
  LOCALE,
  Effect.gen(function* () {
    const preferences = yield* LOCALE_PREFERENCES;
    const engine = createInstance();
    yield* Effect.promise(() =>
      engine.init({
        resources,
        lng: defaultLanguage,
        fallbackLng: InterfaceLanguage.English,
        supportedLngs: Object.values(InterfaceLanguage),
        ns: [...namespaces],
        defaultNS: "common",
        keySeparator: false,
        returnNull: false,
        initAsync: false,
        interpolation: { escapeValue: false }
      })
    );
    return new LocaleService(engine, preferences);
  })
);

export function provideLocalePreferences(preferences: LocalePreferences) {
  return Layer.succeed(LOCALE_PREFERENCES, preferences);
}
