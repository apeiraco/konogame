import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { provideTestCli, testCliContext } from "../../../__tests__/support/context.ts";
import { type CliCommand, CliCommandName } from "../../../parser/index.ts";
import { executeInspect } from "../command.ts";

type InspectCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceInspect }>;

function command(overrides: Partial<InspectCommand> = {}): InspectCommand {
  return {
    kind: CliCommandName.workspaceInspect,
    json: true,
    interactive: true,
    nonInteractive: false,
    root: "synthetic",
    ...overrides
  } as InspectCommand;
}

for (const suppliedHost of [false, true])
  it.effect(
    `inspect prompts for the Host and Installation when a Host is ${suppliedHost ? "supplied" : "missing"}`,
    () =>
      Effect.gen(function* () {
        const selections: { hostId?: string; installationId?: string }[] = [];
        const io = testCliContext({
          interactive: true,
          select: (message, options) => {
            expect(options.some((item) => item.label.includes("Synthetic"))).toBe(true);
            return Effect.succeed(message.startsWith("Host") ? "host" : "installation");
          }
        });
        yield* provideTestCli(
          executeInspect(command(suppliedHost ? { hostId: "host" } : {})),
          io.context,
          {
            workspace: {
              inspectWorkspace: (
                _root: string,
                selection: { hostId?: string; installationId?: string }
              ) =>
                Effect.sync(() => {
                  selections.push(selection);
                  return {
                    hosts: [{ id: "host", label: "Synthetic Host" }],
                    installations: [
                      {
                        id: "installation",
                        hostId: "host",
                        uniformName: "Synthetic Installation"
                      }
                    ],
                    selection
                  };
                })
            }
          }
        );
        expect(selections.at(-1)?.hostId).toBe("host");
        expect(selections.at(-1)?.installationId).toBe("installation");
      })
  );
