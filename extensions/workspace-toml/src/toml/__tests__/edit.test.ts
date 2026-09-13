import assert from "node:assert/strict";
import { test } from "vitest";
import { editConfigurationToml } from "../edit.ts";
import { parseConfigurationToml } from "../parser.ts";

test.each([
  'title = "before" # title\r\n# stable\r\n[settings]\r\narguments = ["old"] # args\r\n[settings.preferredAdapters]\r\n"save.store" = "old"\r\n',
  'title = "before" # title\r\n# stable\r\nsettings = { arguments = ["old"], preferredAdapters = { "save.store" = "old" } } # settings\r\n',
  'title = "before" # title\r\n# stable\r\nsettings.arguments = ["old"] # args\r\nsettings.preferredAdapters."save.store" = "old"\r\n'
])("TOML edits preserve unrelated tokens across table, inline and dotted forms", (content) => {
  const after = JSON.parse(JSON.stringify(parseConfigurationToml(content).data));
  after.title = "after";
  after.settings.arguments = [];
  after.settings.preferredAdapters["save.store"] = "new";
  after.settings.clear = { launchEntry: true };
  const edited = editConfigurationToml(content, after);
  assert(edited.includes("# title\r\n# stable\r\n"));
  assert(!edited.replaceAll("\r\n", "").includes("\n"));
  assert.deepEqual(JSON.parse(JSON.stringify(parseConfigurationToml(edited).data)), after);
});

test("TOML table deletion keeps comments and exact unrelated content", () => {
  const content =
    'title = "stable"\n[settings] # old settings\narguments = [] # old arguments\n[settings.preferredAdapters] # old map\n"save.store" = "one" # old choice\n[unrelated]\nvalue=42 # exact\n';
  const after = JSON.parse(JSON.stringify(parseConfigurationToml(content).data));
  delete after.settings;
  const edited = editConfigurationToml(content, after);
  assert(edited.includes("[unrelated]\nvalue=42 # exact\n"));
  for (const comment of ["# old settings", "# old arguments", "# old map", "# old choice"]) {
    assert(edited.includes(comment));
  }
});

test("TOML inline additions and deletions preserve remaining value tokens", () => {
  const content =
    'settings = { arguments = [], launchEntry = "old", preferredAdapters={ "save.store"="stable" } } # keep\n';
  const after = JSON.parse(JSON.stringify(parseConfigurationToml(content).data));
  delete after.settings.launchEntry;
  after.settings.clear = { launchEntry: true };
  const edited = editConfigurationToml(content, after);
  assert(edited.includes('preferredAdapters={ "save.store"="stable" }'));
  assert(edited.endsWith(" # keep\n"));
});

test("TOML header removal uses parsed quoted keys and preserves array-table comments", () => {
  const content =
    'name="stable"\n[settings.adapterOptions."demo.adapter"."a#b]中文"] # table\nvalue=true # value\n[[sources]] # source\nid="manual" # id\nkind="manual"\nstatus="configured"\n';
  const after = JSON.parse(JSON.stringify(parseConfigurationToml(content).data));
  delete after.settings;
  after.sources = [];
  const edited = editConfigurationToml(content, after);
  for (const comment of ["# table", "# value", "# source", "# id"]) {
    assert(edited.includes(comment));
  }
  assert(edited.startsWith('name="stable"\n'));
});

test("TOML replaced and removed multiline array comments survive beside the field", () => {
  const content =
    'settings.arguments = [\r\n  "old", # argument purpose\r\n  # keep rationale\r\n]\r\nname="stable" # exact\r\n';
  for (const settings of [{ arguments: [] }, {}]) {
    const edited = editConfigurationToml(content, { settings, name: "stable" });
    assert(edited.includes("# argument purpose"));
    assert(edited.includes("# keep rationale"));
    assert(edited.includes('name="stable" # exact\r\n'));
  }
});

test("TOML removes dotted inline map members without rewriting siblings", () => {
  const content =
    'settings = { preferredAdapters.a="one", preferredAdapters.b="two", arguments = [] } # keep\n';
  const edited = editConfigurationToml(content, { settings: { arguments: [] } });
  assert(edited.includes("arguments = []"));
  assert(edited.endsWith(" # keep\n"));
});
