import { artifactFromDirectory } from "@konogame/extension-filesystem";
import { RECOVERY_ONLY_REVISION, RenameStatus, workspaceJsonSchema } from "@konogame/workspace";
import { Args, Command, Flags } from "@oclif/core";
import { v7 as uuidv7 } from "uuid";
import { Cancelled, output, required, runtime } from "./runtime.ts";

const commonFlags = {
  json: Flags.boolean({ description: "Write machine readable JSON without prompts" }),
  interactive: Flags.boolean({
    description: "Enable interactive prompts on a terminal (also accepts =false)"
  }),
  "interactive=false": Flags.boolean({ hidden: true }),
  "interactive=true": Flags.boolean({ hidden: true }),
  "non-interactive": Flags.boolean({ description: "Disable interactive prompts" }),
  help: Flags.boolean({ char: "h", description: "Show command help" })
};
const adapterFlag = Flags.string({ description: "Require this Adapter ID" });

abstract class CliCommand extends Command {
  protected override async catch(error: Error): Promise<never> {
    throw error;
  }
}

class Features extends CliCommand {
  static override description = "List available Features";
  static override flags = commonFlags;
  async run() {
    await this.parse(Features);
    const features = runtime().app.features();
    if (runtime().json) output(features);
    else runtime().stdout(`${features.join("\n")}\n`);
  }
}

class Plan extends CliCommand {
  static override description = "Resolve a Feature's Binding Plan";
  static override flags = { ...commonFlags, adapter: adapterFlag };
  static override args = {
    feature: Args.string({ ignoreStdin: true }),
    "adapter-id": Args.string({ ignoreStdin: true })
  };
  async run() {
    const { args, flags } = await this.parse(Plan);
    const feature = await required(args.feature, "feature");
    if (flags.adapter && args["adapter-id"] && flags.adapter !== args["adapter-id"])
      throw new Error("Conflicting Adapter preferences");
    const adapter = flags.adapter ?? args["adapter-id"];
    output(runtime().app.plan([feature], adapter === undefined ? {} : { [feature]: adapter }));
  }
}

class SaveStore extends CliCommand {
  static override description = "Stream a save directory into the local store";
  static override flags = { ...commonFlags, adapter: adapterFlag };
  static override args = { directory: Args.string({ ignoreStdin: true }) };
  async run() {
    const { args, flags } = await this.parse(SaveStore);
    const directory = await required(args.directory, "directory");
    if (
      runtime().interactive &&
      !(await runtime().prompts.confirm(`Store save from ${directory}?`))
    )
      throw new Cancelled("Cancelled");
    output(await runtime().app.storeSave(await artifactFromDirectory(directory), flags.adapter));
  }
}

class WorkspaceSchema extends CliCommand {
  static override description = "Export the current Workspace JSON Schema";
  static override flags = commonFlags;
  async run() {
    await this.parse(WorkspaceSchema);
    output(workspaceJsonSchema());
  }
}

class WorkspaceInspect extends CliCommand {
  static override description = "Inspect Workspace records and effective settings";
  static override flags = { ...commonFlags, adapter: adapterFlag };
  static override args = {
    root: Args.string({ ignoreStdin: true }),
    "host-id": Args.string({ ignoreStdin: true }),
    "installation-id": Args.string({ ignoreStdin: true })
  };
  async run() {
    const { args, flags } = await this.parse(WorkspaceInspect);
    const root = await required(args.root, "root");
    let hostId = args["host-id"];
    let installationId = args["installation-id"];
    if (runtime().interactive && (hostId === undefined || installationId === undefined)) {
      const initial = await runtime().app.inspectWorkspace(root, {
        preferredAdapterId: flags.adapter
      });
      if (hostId === undefined && initial.hosts.length) {
        hostId =
          (await runtime().prompts.select("Host (optional)", [
            { value: "", label: "All records without a Host selection" },
            ...initial.hosts.map((host) => ({
              value: host.id,
              label: `${host.label} (${host.id})`
            }))
          ])) || undefined;
      }
      if (hostId && installationId === undefined) {
        const installations = initial.installations.filter((item) => item.hostId === hostId);
        if (installations.length)
          installationId =
            (await runtime().prompts.select("Installation (optional)", [
              { value: "", label: "Host settings only" },
              ...installations.map((item) => ({
                value: item.id,
                label: `${item.uniformName} (${item.id})`
              }))
            ])) || undefined;
      }
    }
    output(
      await runtime().app.inspectWorkspace(root, {
        hostId,
        installationId,
        preferredAdapterId: flags.adapter
      })
    );
  }
}

class WorkspaceRename extends CliCommand {
  static override description = "Rename a Workspace record's uniform name with a revision check";
  static override flags = {
    ...commonFlags,
    adapter: adapterFlag,
    "expected-revision": Flags.string({
      description: "Expected Workspace revision (defaults to inspected revision)"
    }),
    "operation-id": Flags.string({ description: "Stable UUID for retrying an operation" })
  };
  static override args = {
    root: Args.string({ ignoreStdin: true }),
    "record-id": Args.string({ ignoreStdin: true }),
    "uniform-name": Args.string({ ignoreStdin: true })
  };
  async run() {
    const { args, flags } = await this.parse(WorkspaceRename);
    const root = await required(args.root, "root");
    let recordId = args["record-id"];
    let uniformName = args["uniform-name"];
    if (!runtime().interactive) {
      recordId = await required(recordId, "record-id");
      uniformName = await required(uniformName, "uniform-name");
    }
    let expectedRevision = flags["expected-revision"];
    let inspection: Awaited<ReturnType<CliRuntimeApplication["inspectWorkspace"]>> | undefined;
    if (expectedRevision === undefined || recordId === undefined) {
      try {
        inspection = await runtime().app.inspectWorkspace(root, {
          preferredAdapterId: flags.adapter
        });
        expectedRevision ??= inspection.revision;
      } catch (error) {
        runtime().stderr(
          `Workspace inspection failed; attempting recovery only: ${error instanceof Error ? error.message : String(error)}\n`
        );
        expectedRevision ??= RECOVERY_ONLY_REVISION;
      }
    }
    if (recordId === undefined && runtime().interactive && inspection) {
      const records = [...inspection.games, ...inspection.hosts, ...inspection.installations];
      if (records.length)
        recordId = await runtime().prompts.select(
          "Record to rename",
          records.map((record) => ({
            value: record.id,
            label: `${record.uniformName} (${record.id})`
          }))
        );
    }
    recordId = await required(recordId, "record-id");
    uniformName = await required(uniformName, "uniform-name");
    if (
      runtime().interactive &&
      !(await runtime().prompts.confirm(`Rename ${recordId} to ${uniformName}?`))
    )
      throw new Cancelled("Cancelled");
    const result = await runtime().app.renameWorkspace(
      {
        root,
        recordId,
        uniformName,
        expectedRevision: expectedRevision!,
        operationId: flags["operation-id"] ?? uuidv7()
      },
      flags.adapter
    );
    output(result);
    if (result.status !== RenameStatus.Renamed && result.status !== RenameStatus.Unchanged)
      throw new Error(`Workspace rename ${result.status}`);
  }
}

type CliRuntimeApplication = ReturnType<typeof runtime>["app"];

export const commands = {
  features: Features,
  plan: Plan,
  "save:store": SaveStore,
  "workspace:schema": WorkspaceSchema,
  "workspace:inspect": WorkspaceInspect,
  "workspace:rename": WorkspaceRename
};
