import { expect, test } from "vitest";
import { resources } from "../resources.ts";

interface Catalog {
  readonly [key: string]: string | Catalog;
}

function messages(catalog: Catalog, locale: string) {
  const entries = new Map<string, string>();
  const plurals = new Map<string, Set<string>>();
  function visit(node: Catalog, prefix: string) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix + key;
      if (typeof value !== "string") {
        visit(value, `${path}.`);
        continue;
      }
      expect(value.trim(), `${locale}: ${path}`).not.toBe("");
      const plural = /_(zero|one|two|few|many|other)$/.exec(key);
      const logicalPath = plural ? path.slice(0, -plural[0].length) : path;
      if (plural) {
        const forms = plurals.get(logicalPath) ?? new Set<string>();
        forms.add(plural[1]!);
        plurals.set(logicalPath, forms);
      }
      const names = Array.from(
        value.matchAll(/\{\{\s*-?\s*([\w.]+)(?:\s*,[^}]+)?\s*\}\}/g),
        (match) => match[1]
      );
      const signature = JSON.stringify([Boolean(plural), [...new Set(names)].sort()]);
      if (entries.has(logicalPath)) {
        expect(signature, logicalPath).toEqual(entries.get(logicalPath));
      }
      entries.set(logicalPath, signature);
    }
  }
  visit(catalog, "");
  for (const [key, forms] of plurals) {
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
      expect(forms.has(category), `${locale}: missing ${key}_${category}`).toBe(true);
    }
  }
  return entries;
}

test("catalogs cover the same messages and interpolation parameters with each language's plural forms", () => {
  expect(messages(resources["zh-CN"], "zh-CN")).toEqual(messages(resources.en, "en"));
});
