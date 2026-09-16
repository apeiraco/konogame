import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { vi } from "vitest";
import { NodeWorkspaceBrowseFileSystem, WORKSPACE_BROWSE_SCAN_LIMIT } from "../io.ts";

const native = vi.hoisted(() => ({ access: vi.fn(), opendir: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  access: native.access,
  opendir: native.opendir
}));
vi.mock("node:os", () => ({ homedir: () => "C:\\Users\\Synthetic" }));

it.effect("bounds examination of omitted files and closes the directory after truncation", () =>
  Effect.gen(function* () {
    const read = vi.fn(async () => ({
      name: "synthetic.txt",
      isDirectory: () => false,
      isSymbolicLink: () => false
    }));
    const close = vi.fn(async () => {});
    native.opendir.mockResolvedValueOnce({ read, close });
    const listing = yield* new NodeWorkspaceBrowseFileSystem().listDirectories(
      "C:\\Synthetic",
      500
    );
    expect(listing).toEqual({ entries: [], complete: false });
    expect(read).toHaveBeenCalledTimes(WORKSPACE_BROWSE_SCAN_LIMIT + 1);
    expect(close).toHaveBeenCalledOnce();
  })
);

it.effect("closes a directory when a pending browse is interrupted", () =>
  Effect.gen(function* () {
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const close = vi.fn(async () => {});
    native.opendir.mockResolvedValueOnce({
      read: () => {
        reading();
        return new Promise(() => {});
      },
      close
    });
    const fiber = yield* Effect.forkChild(
      new NodeWorkspaceBrowseFileSystem().listDirectories("C:\\Synthetic", 500)
    );
    yield* Effect.promise(() => started);
    yield* Fiber.interrupt(fiber);
    expect(close).toHaveBeenCalledOnce();
  })
);

it.effect("offers only accessible Windows drive roots after a bounded set of probes", () =>
  Effect.gen(function* () {
    native.access.mockReset();
    native.access.mockImplementation(async (path: string) => {
      if (path !== "C:\\" && path !== "D:\\") {
        throw Object.assign(new Error("Synthetic unavailable drive"), { code: "ENOENT" });
      }
    });
    const points = yield* new NodeWorkspaceBrowseFileSystem("win32").startingPoints();
    expect(points).toEqual([
      { path: "C:\\Users\\Synthetic", label: "C:\\Users\\Synthetic" },
      { path: "C:\\", label: "C:\\" },
      { path: "D:\\", label: "D:\\" }
    ]);
    expect(native.access).toHaveBeenCalledTimes(26);
    expect(new Set(native.access.mock.calls.map(([path]) => path)).size).toBe(26);
  })
);
