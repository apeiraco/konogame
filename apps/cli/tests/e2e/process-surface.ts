import { writeFileSync } from "node:fs";
import { runDefaultStreams } from "./default-streams.ts";
import { runOwnerContext } from "./owner-context.ts";

export async function runProcessSurface(entry: string, reportPath: string): Promise<void> {
  if (!entry || !reportPath) throw new Error("Missing process surface arguments");
  writeFileSync(reportPath, JSON.stringify(await runOwnerContext(entry)));
  await runDefaultStreams();
}

if (import.meta.main) await runProcessSurface(process.argv[2] ?? "", process.argv[3] ?? "");
