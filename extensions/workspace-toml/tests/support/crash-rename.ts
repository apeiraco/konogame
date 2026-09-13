import {
  NodeWorkspaceFileSystem,
  NodeWorkspaceImportFileSystem,
  NodeWorkspaceManagementFileSystem,
  TomlWorkspaceConfiguration
} from "@konogame/extension-workspace-toml";
import { UuidIdService } from "@konogame/infrastructure";
import { Effect } from "effect";

export async function crashDuringRename(
  crashAt: number,
  input: Parameters<TomlWorkspaceConfiguration["rename"]>[0]
): Promise<void> {
  let count = 0;

  class CrashFileSystem extends NodeWorkspaceFileSystem {
    override move(from: string, to: string) {
      return Effect.suspend(() => {
        count += 1;
        if (count === crashAt) {
          process.exit(79);
        }
        return super.move(from, to);
      });
    }
  }

  const node = new CrashFileSystem();
  const ids = new UuidIdService();
  const adapter = new TomlWorkspaceConfiguration(
    node,
    new NodeWorkspaceImportFileSystem(node, ids),
    new NodeWorkspaceManagementFileSystem(node, ids),
    undefined,
    ids
  );
  await Effect.runPromise(adapter.rename(input));
  process.exit(0);
}

if (import.meta.main) {
  await crashDuringRename(Number(process.argv[2]), JSON.parse(process.argv[3] ?? ""));
}
