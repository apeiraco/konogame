import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../../../..");
const main = resolve(root, "apps/cli/dist/main.js");

test("real executable routes topics, help, and clean JSON from any working directory", async () => {
  const schema = await exec(process.execPath, [main, "workspace", "schema", "--json"], {
    cwd: tmpdir()
  });
  expect(JSON.parse(schema.stdout).$schema).toContain("json-schema.org");
  expect(schema.stderr).toBe("");
  const help = await exec(process.execPath, [main, "workspace", "rename", "--help"], {
    cwd: tmpdir()
  });
  expect(help.stdout).toContain("workspace rename");
  expect(help.stdout).toContain("--expected-revision");
  expect(help.stderr).toBe("");
  for (const flag of ["--interactive=false", "--non-interactive"]) {
    const result = await exec(process.execPath, [main, "plan", "save.store", flag]);
    expect(JSON.parse(result.stdout).bindings[0].adapterId).toBe("filesystem.save-store");
    expect(result.stderr).toBe("");
  }
});

test("unknown commands, missing arguments, and contradictory flags fail without prompts", async () => {
  for (const args of [
    ["missing"],
    ["save", "store", "--non-interactive"],
    ["features", "--interactive", "--interactive=false"]
  ]) {
    await expect(exec(process.execPath, [main, ...args], { timeout: 5_000 })).rejects.toMatchObject(
      { code: 1, stdout: "" }
    );
  }
});

test("root interaction switches work without a command and before topics", async () => {
  for (const flag of ["--non-interactive", "--interactive=false"]) {
    const result = await exec(process.execPath, [main, flag]);
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toBe("");
  }
  const result = await exec(process.execPath, [main, "--json", "workspace", "schema"]);
  expect(JSON.parse(result.stdout).$schema).toContain("json-schema.org");
  await expect(exec(process.execPath, [main, "--json"])).rejects.toMatchObject({
    code: 1,
    stdout: ""
  });
});

test("-- preserves positional flag text", async () => {
  const result = await exec(process.execPath, [
    main,
    "plan",
    "save.store",
    "--",
    "--interactive=false"
  ]);
  const plan = JSON.parse(result.stdout);
  expect(plan.unavailable[0].reason).toContain("--interactive=false");
});

async function injected(script: string) {
  const result = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { runCli, Cancelled } from ${JSON.stringify(pathToFileURL(main).href)};
    import assert from "node:assert/strict";
    let stdout = "", stderr = "";
    const output = { stdout: text => stdout += text, stderr: text => stderr += text };
    const unavailable = async () => { throw new Error("Unexpected prompt"); };
    const prompts = { text: unavailable, select: unavailable, confirm: unavailable };
    ${script}
  `
    ],
    { cwd: tmpdir(), timeout: 8_000 }
  );
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
}

test("terminal menu and missing arguments use injected prompts", async () => {
  await injected(`
    const asked = [];
    const app = { plan(features) { return { features }; } };
    prompts.select = async (message) => { asked.push(message); return "plan"; };
    prompts.text = async (message) => { asked.push(message); return "save.store"; };
    const code = await runCli([], { ...output, isTTY: true, env: {}, application: app, prompts });
    assert.equal(code, 0);
    assert.deepEqual(asked, ["Choose a command", "feature"]);
    assert.deepEqual(JSON.parse(stdout), { features: ["save.store"] });
    assert.equal(stderr, "");
  `);
});

test("cancelling save or rename never dispatches a write", async () => {
  await injected(`
    let writes = 0;
    const app = {
      storeSave() { writes++; throw new Error("Unexpected write"); },
      renameWorkspace() { writes++; throw new Error("Unexpected write"); },
      async inspectWorkspace() { return { revision: "revision", workspace: {}, games: [], hosts: [], installations: [] }; }
    };
    prompts.confirm = async () => false;
    for (const args of [["save", "store", "synthetic"], ["workspace", "rename", "synthetic", "record", "new-name"]]) {
      assert.equal(await runCli(args, { ...output, isTTY: true, env: {}, application: app, prompts }), 130);
    }
    prompts.text = async () => { throw new Cancelled(); };
    assert.equal(await runCli(["save", "store"], { ...output, isTTY: true, env: {}, application: app, prompts }), 130);
    assert.equal(writes, 0);
    assert.equal(stdout, "");
  `);
});

test("JSON and non-terminal missing arguments never prompt, even with explicit interactive flag", async () => {
  await injected(`
    for (const options of [{ isTTY: false }, { isTTY: true }]) {
      const args = ["plan", "--interactive", ...(options.isTTY ? ["--json"] : [])];
      assert.equal(await runCli(args, { ...output, ...options, env: {}, prompts }), 1);
      assert.match(stderr, /Missing required argument/);
    }
    assert.equal(stdout, "");
  `);
});

test("rename uses inspected revision and UUIDv7, and writes only after confirmation", async () => {
  await injected(`
    const calls = [];
    const app = {
      async inspectWorkspace() { return { revision: "observed-revision", games: [], hosts: [], installations: [] }; },
      async renameWorkspace(input, adapter) { calls.push(input, adapter); return { status: "renamed", revision: "next" }; }
    };
    prompts.confirm = async () => true;
    assert.equal(await runCli(["workspace", "rename", "synthetic", "record", "new-name", "--adapter", "fixture"], { ...output, isTTY: true, env: {}, application: app, prompts }), 0);
    assert.equal(calls[0].expectedRevision, "observed-revision");
    assert.equal(calls[0].operationId[14], "7");
    assert.equal(calls[1], "fixture");
    assert.equal(JSON.parse(stdout).status, "renamed");
  `);
});

test("rename retries with an explicit revision bypass inspection, and failed inspection still reaches recovery", async () => {
  await injected(`
    let reads = 0;
    const revisions = [];
    const app = {
      async inspectWorkspace() { reads++; throw new Error("Interrupted directory layout"); },
      async renameWorkspace(input) { revisions.push(input.expectedRevision); return { status: "renamed" }; }
    };
    const base = ["workspace", "rename", "synthetic", "record", "new-name", "--json"];
    const options = { ...output, env: {}, isTTY: false, prompts, application: app };
    assert.equal(await runCli([...base, "--expected-revision", "original"], options), 0);
    assert.equal(reads, 0);
    assert.equal(await runCli(base, options), 0);
    assert.deepEqual(revisions, ["original", "recovery-only"]);
    assert.match(stderr, /Interrupted directory layout/);
  `);
});

test("rename failures preserve machine results and return a failing exit status", async () => {
  await injected(`
    for (const status of ["conflict", "recovery-required", "failed"]) {
      stdout = "";
      const application = { async renameWorkspace() { return { status, reason: "synthetic reason" }; } };
      const code = await runCli(["workspace", "rename", "synthetic", "record", "name", "--expected-revision", "original", "--json"], { ...output, env: {}, isTTY: true, prompts, application });
      assert.equal(code, 1);
      assert.equal(JSON.parse(stdout).status, status);
    }
  `);
});

test("inspect prompts for a Host and Installation, including when a Host was supplied", async () => {
  await injected(`
    for (const suppliedHost of [false, true]) {
      const selections = [];
      const app = {
        async inspectWorkspace(root, selection) {
          selections.push(selection);
          return {
            hosts: [{ id: "host", label: "Synthetic Host" }],
            installations: [{ id: "installation", hostId: "host", uniformName: "Synthetic Installation" }],
            selection
          };
        }
      };
      prompts.select = async (message, options) => {
        assert.ok(options.some(item => item.label.includes("Synthetic")));
        return message.startsWith("Host") ? "host" : "installation";
      };
      const args = ["workspace", "inspect", "synthetic", ...(suppliedHost ? ["host"] : [])];
      assert.equal(await runCli(args, { ...output, env: {}, isTTY: true, prompts, application: app }), 0);
      assert.equal(selections.at(-1).hostId, "host");
      assert.equal(selections.at(-1).installationId, "installation");
    }
  `);
});
