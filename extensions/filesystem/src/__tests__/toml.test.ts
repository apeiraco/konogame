import assert from "node:assert/strict";
import { test } from "vitest";
import { parseConfigurationToml } from "../toml.ts";

test("TOML 1.0 supports dotted, quoted, multiline and array tables with safe prototype keys", () => {
  const { data } = parseConfigurationToml(
    '"quoted.key" = "value"\nname = """\nHello\nworld"""\n[a.b]\nx = 1\n[a]\n[[items]]\n[[items]]\nvalue = 0x10\n[__proto__]\npolluted = true\n[constructor.prototype]\nx = true\n'
  );
  assert.equal(Object.getPrototypeOf(data), null);
  assert.equal(data["quoted.key"], "value");
  assert.equal(data.name, "Hello\nworld");
  assert.deepEqual(JSON.parse(JSON.stringify(data.a)), { b: { x: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(data.items)), [{}, { value: 16 }]);
  // biome-ignore lint/suspicious/noProto: This is an untrusted TOML key, deliberately tested as data.
  assert.equal(Object.getPrototypeOf(data.__proto__), null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  for (const content of [
    "x = 1979-05-27",
    "x = 1979-05-27T07:32:00Z",
    "x = 07:32:00",
    "x = inf",
    "x = nan",
    "x = 9007199254740992",
    "x = null",
    "x = 1\nx = 2",
    "[x]\n[x]"
  ])
    assert.throws(() => parseConfigurationToml(content));
});
