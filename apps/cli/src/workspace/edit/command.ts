import { resolve } from "node:path";
import { assertSettings, configurationEditChangeSchema, hostSchema } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT, workspaceEditPreviewSchema } from "@konogame/workspace/management";
import { Effect } from "effect";
import {
  CLI_CONTEXT,
  type CliCommandEffect,
  CliError,
  cliChecked,
  output,
  required
} from "../../context.ts";
import { type CliCommand, CliCommandName } from "../../parser/index.ts";
import { readBoundedJson } from "../../preview.ts";
import { confirmWrite, successfulWrite } from "../write.ts";

type EditCommand = Extract<
  CliCommand,
  {
    kind:
      | typeof CliCommandName.workspaceEditPreview
      | typeof CliCommandName.workspaceEditApply
      | typeof CliCommandName.workspaceEditRecover;
  }
>;

type EditFlags = {
  adapter?: string;
  "change-file"?: string;
  "record-id"?: string;
  "host-id"?: string;
  "game-id"?: string;
  kind?: string;
  name?: string;
  title?: string;
  edition?: string;
  "unset-edition": boolean;
  label?: string;
  "root-set"?: readonly string[];
  "root-remove"?: readonly string[];
  "source-set"?: readonly string[];
  "source-remove"?: readonly string[];
  "settings-json"?: string;
  "arguments-json"?: string;
  "preferred-adapter"?: readonly string[];
  "clear-preferred-adapter"?: readonly string[];
};

function assignment(value: string): [string, string] {
  const index = value.indexOf("=");
  if (index < 1 || index === value.length - 1)
    throw new Error("Expected a nonempty key=value assignment");
  return [value.slice(0, index), value.slice(index + 1)];
}

function editChange(root: string, flags: EditFlags) {
  return Effect.gen(function* () {
    if (flags["host-id"] && flags["record-id"] && flags["host-id"] !== flags["record-id"])
      return yield* Effect.fail(new CliError({ message: "Conflicting Host and record targets" }));
    for (const [sets, removals] of [
      [flags["root-set"]?.map((value) => assignment(value)[0]), flags["root-remove"]],
      [flags["source-set"]?.map((value) => value.split(":")[0]!), flags["source-remove"]],
      [
        flags["preferred-adapter"]?.map((value) => assignment(value)[0]),
        flags["clear-preferred-adapter"]
      ]
    ] as const) {
      if (sets?.some((key) => removals?.includes(key)))
        return yield* Effect.fail(
          new CliError({ message: "Cannot set and remove or clear the same key in one edit" })
        );
    }
    const metadata =
      [flags.name, flags.title, flags.edition, flags.label].some((value) => value !== undefined) ||
      flags["unset-edition"];
    const roots = Boolean(flags["root-set"]?.length || flags["root-remove"]?.length);
    const sources = Boolean(flags["source-set"]?.length || flags["source-remove"]?.length);
    const settings =
      flags["settings-json"] !== undefined ||
      flags["arguments-json"] !== undefined ||
      Boolean(flags["preferred-adapter"]?.length || flags["clear-preferred-adapter"]?.length);
    if (
      [Boolean(flags["change-file"]), metadata, roots, sources, settings].filter(Boolean).length !==
      1
    )
      return yield* Effect.fail(
        new CliError({
          message:
            "Select exactly one edit category: change-file, metadata, roots, sources, or settings"
        })
      );
    if (flags["change-file"])
      return yield* cliChecked(
        configurationEditChangeSchema.assert,
        yield* readBoundedJson(flags["change-file"])
      );
    const { snapshot } = yield* (yield* WORKSPACE_MANAGEMENT).read(root, flags.adapter);
    const recordId =
      flags["host-id"] ??
      flags["record-id"] ??
      (flags.name !== undefined || flags.kind === "workspace" ? snapshot.workspace.id : undefined);
    const record = [
      snapshot.workspace,
      ...snapshot.games,
      ...snapshot.hosts,
      ...snapshot.installations
    ].find((record) => record.id === recordId);
    if (!record)
      return yield* Effect.fail(
        new CliError({ message: "Select an existing record with --record-id or --host-id" })
      );
    if (metadata) {
      if (flags.edition !== undefined && flags["unset-edition"])
        return yield* Effect.fail(
          new CliError({ message: "Cannot set and unset edition together" })
        );
      const projection =
        record.kind === "game"
          ? {
              title: flags.title ?? record.title,
              ...((flags.edition ?? (!flags["unset-edition"] ? record.edition : undefined)) ===
              undefined
                ? {}
                : { edition: flags.edition ?? record.edition })
            }
          : record.kind === "workspace"
            ? { name: flags.name ?? record.name }
            : record.kind === "host"
              ? { label: flags.label ?? record.label }
              : {};
      if (
        (flags.name !== undefined && record.kind !== "workspace") ||
        ((flags.title !== undefined || flags.edition !== undefined || flags["unset-edition"]) &&
          record.kind !== "game") ||
        (flags.label !== undefined && record.kind !== "host")
      )
        return yield* Effect.fail(
          new CliError({ message: "Metadata field does not belong to the selected record" })
        );
      return yield* cliChecked(configurationEditChangeSchema.assert, {
        kind: "metadata.replace",
        target: { kind: record.kind, recordId: record.id },
        metadata: projection
      });
    }
    if (roots || sources) {
      if (record.kind !== "host")
        return yield* Effect.fail(new CliError({ message: "Roots and sources require a Host" }));
      if (roots) {
        const updated = { ...record.roots };
        for (const key of flags["root-remove"] ?? []) delete updated[key];
        for (const value of flags["root-set"] ?? []) {
          const [key, path] = yield* cliChecked(assignment, value);
          Object.defineProperty(updated, key, {
            value: path,
            enumerable: true,
            configurable: true,
            writable: true
          });
        }
        return yield* cliChecked(configurationEditChangeSchema.assert, {
          kind: "host.roots.replace",
          hostId: record.id,
          roots: updated
        });
      }
      const updated = record.sources.filter(
        (source) => !flags["source-remove"]?.includes(source.id)
      );
      for (const value of flags["source-set"] ?? []) {
        const [id, kind, status, extra] = value.split(":");
        if (!id || !kind || !status || extra !== undefined)
          return yield* Effect.fail(
            new CliError({ message: "Expected source id:kind:configured|planned" })
          );
        const index = updated.findIndex((source) => source.id === id);
        const source = (yield* cliChecked(hostSchema.get("sources").assert, [
          { id, kind, status }
        ]))[0]!;
        if (index < 0) updated.push(source);
        else updated[index] = source;
      }
      return yield* cliChecked(configurationEditChangeSchema.assert, {
        kind: "host.sources.replace",
        hostId: record.id,
        sources: updated
      });
    }
    const targetKind = flags.kind ?? record.kind;
    const previous =
      targetKind === "host-game" && record.kind === "host"
        ? (record.gameOverrides[flags["game-id"] ?? ""] ?? {})
        : record.kind === "host" || record.kind === "workspace"
          ? record.defaults
          : record.settings;
    if (
      flags["settings-json"] !== undefined &&
      (flags["arguments-json"] !== undefined ||
        flags["preferred-adapter"]?.length ||
        flags["clear-preferred-adapter"]?.length)
    )
      return yield* Effect.fail(
        new CliError({ message: "Use settings-json alone for a complete replacement" })
      );
    const updated =
      flags["settings-json"] === undefined
        ? structuredClone(previous)
        : assertSettings(yield* cliChecked(JSON.parse, flags["settings-json"]));
    if (flags["arguments-json"] !== undefined)
      updated.arguments = assertSettings({
        arguments: yield* cliChecked(JSON.parse, flags["arguments-json"])
      }).arguments;
    for (const value of flags["preferred-adapter"] ?? []) {
      const [feature, adapter] = yield* cliChecked(assignment, value);
      updated.preferredAdapters = { ...updated.preferredAdapters, [feature]: adapter };
      if (updated.clear?.preferredAdapters)
        updated.clear.preferredAdapters = updated.clear.preferredAdapters.filter(
          (key) => key !== feature
        );
    }
    for (const feature of flags["clear-preferred-adapter"] ?? []) {
      if (updated.preferredAdapters) delete updated.preferredAdapters[feature];
      updated.clear = {
        ...updated.clear,
        preferredAdapters: [...new Set([...(updated.clear?.preferredAdapters ?? []), feature])]
      };
    }
    return yield* cliChecked(configurationEditChangeSchema.assert, {
      kind: "settings.replace",
      target: {
        kind: targetKind,
        recordId: record.id,
        ...(targetKind === "host-game"
          ? { gameId: yield* required(flags["game-id"], "game-id") }
          : {})
      },
      settings: updated
    });
  });
}

function editFlagsOf(
  command: Extract<CliCommand, { kind: typeof CliCommandName.workspaceEditPreview }>
): EditFlags {
  return {
    adapter: command.adapter,
    "change-file": command.changeFile,
    "record-id": command.recordId,
    "host-id": command.hostId,
    "game-id": command.gameId,
    kind: command.kindName,
    name: command.name,
    title: command.title,
    edition: command.edition,
    "unset-edition": command.unsetEdition,
    label: command.label,
    "root-set": command.rootSet,
    "root-remove": command.rootRemove,
    "source-set": command.sourceSet,
    "source-remove": command.sourceRemove,
    "settings-json": command.settingsJson,
    "arguments-json": command.argumentsJson,
    "preferred-adapter": command.preferredAdapter,
    "clear-preferred-adapter": command.clearPreferredAdapter
  };
}

export function executeEdit(command: EditCommand): CliCommandEffect {
  return Effect.gen(function* () {
    switch (command.kind) {
      case CliCommandName.workspaceEditPreview: {
        const root = resolve(yield* required(command.root, "root"));
        return yield* output(
          yield* (yield* WORKSPACE_MANAGEMENT).preview({
            root,
            change: yield* editChange(root, editFlagsOf(command)),
            preferredAdapterId: command.adapter,
            operationId: command.operationId
          })
        );
      }
      case CliCommandName.workspaceEditApply: {
        const context = yield* CLI_CONTEXT;
        const root = resolve(yield* required(command.root, "root"));
        const preview = yield* cliChecked(
          workspaceEditPreviewSchema.assert,
          yield* readBoundedJson(yield* required(command.previewFile, "preview-file"))
        );
        if (context.interactive)
          yield* context.stderr(`${JSON.stringify(preview.differences, null, 2)}\n`);
        yield* confirmWrite(
          command.yes,
          `Apply ${preview.differences.length} reviewed field change(s) in ${root}?`
        );
        return yield* successfulWrite(
          yield* (yield* WORKSPACE_MANAGEMENT).apply({ root, preview })
        );
      }
      case CliCommandName.workspaceEditRecover: {
        const root = resolve(yield* required(command.root, "root"));
        const operationId = yield* required(command.operationId, "operation-id");
        yield* confirmWrite(command.yes, `Recover edit ${operationId} in ${root}?`);
        return yield* successfulWrite(
          yield* (yield* WORKSPACE_MANAGEMENT).recoverEdit({ root, operationId }, command.adapter)
        );
      }
    }
  });
}
