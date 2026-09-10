import { argument, command, option, or } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../../parser/shared.ts";

export const workspaceEditPreview = "workspace edit preview";
export const workspaceEditApply = "workspace edit apply";
export const workspaceEditRecover = "workspace edit recover";

const editFields = {
  adapter,
  changeFile: option("--change-file", text("FILE"), {
    description: message`Strict JSON edit change file`
  }).optional(),
  recordId: option("--record-id", text("UUID"), {
    description: message`Target record UUID`
  }).optional(),
  hostId: option("--host-id", text("UUID"), {
    description: message`Target Host UUID for roots or sources`
  }).optional(),
  gameId: option("--game-id", text("UUID"), {
    description: message`Game UUID for Host/Game settings`
  }).optional(),
  kindName: option("--kind", text("KIND"), {
    description: message`Settings target kind`
  }).optional(),
  name: option("--name", text("NAME"), {
    description: message`Set Workspace display name`
  }).optional(),
  title: option("--title", text("TITLE"), {
    description: message`Set Game title, preserving edition unless explicitly changed`
  }).optional(),
  edition: option("--edition", text("EDITION"), {
    description: message`Set Game edition`
  }).optional(),
  unsetEdition: option("--unset-edition", { description: message`Explicitly remove Game edition` }),
  label: option("--label", text("LABEL"), {
    description: message`Set Host display label`
  }).optional(),
  rootSet: option("--root-set", text("ALIAS_PATH"), {
    description: message`Set a Host root alias: alias=absolute-path (repeatable)`
  }).multiple(),
  rootRemove: option("--root-remove", text("ALIAS"), {
    description: message`Remove a Host root alias (repeatable)`
  }).multiple(),
  sourceSet: option("--source-set", text("SOURCE"), {
    description: message`Set a Host source: id:kind:configured|planned (repeatable)`
  }).multiple(),
  sourceRemove: option("--source-remove", text("ID"), {
    description: message`Remove a Host source ID (repeatable)`
  }).multiple(),
  settingsJson: option("--settings-json", text("JSON"), {
    description: message`Replace the entire selected settings layer with strict JSON`
  }).optional(),
  argumentsJson: option("--arguments-json", text("JSON"), {
    description: message`Replace arguments with a JSON string array in the selected layer`
  }).optional(),
  preferredAdapter: option("--preferred-adapter", text("FEATURE_ADAPTER"), {
    description: message`Set Feature=Adapter in the selected layer (repeatable)`
  }).multiple(),
  clearPreferredAdapter: option("--clear-preferred-adapter", text("FEATURE"), {
    description: message`Explicitly clear a Feature preference (repeatable)`
  }).multiple(),
  operationId: option("--operation-id", text("UUID"), {
    description: message`Stable UUID for this edit`
  }).optional()
};

export const editParser = command(
  "edit",
  or(
    leaf(
      "preview",
      "Preview one metadata, settings, Host root, or source edit without writing",
      workspaceEditPreview,
      { ...editFields, root: argument(text("ROOT")).optional() }
    ),
    leaf(
      "apply",
      "Apply a saved, reviewed edit preview after rechecking its revision",
      workspaceEditApply,
      {
        root: argument(text("ROOT")).optional(),
        previewFile: argument(text("FILE")).optional(),
        yes: option("--yes", { description: message`Confirm the reviewed preview writes` })
      }
    ),
    leaf(
      "recover",
      "Explicitly recover a pending configuration edit using its journal",
      workspaceEditRecover,
      {
        adapter,
        root: argument(text("ROOT")).optional(),
        operationId: argument(text("UUID")).optional(),
        yes: option("--yes", { description: message`Confirm journal recovery writes` })
      }
    )
  ),
  { brief: message`Preview, apply, or recover one configuration edit` }
);
