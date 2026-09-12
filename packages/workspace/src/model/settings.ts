import { assertSchema, type ConfigurationValue } from "@konogame/infrastructure/contracts";
import { SettingsClearField, WorkspaceConflictError, WorkspaceConflictKind } from "./errors.ts";
import { type Settings, settingsSchema } from "./records.ts";

export interface EffectiveSettings {
  values: {
    launchEntry?: string | null;
    arguments?: string[];
    preferredAdapters?: Record<string, string | null>;
    adapterOptions?: Record<string, Record<string, ConfigurationValue> | null>;
  };
  origins: Record<string, string>;
}

export function assertSettings(value: unknown): Settings {
  const settings = assertSchema("workspace.settings", settingsSchema, value);
  if (settings.clear?.launchEntry && settings.launchEntry !== undefined) {
    throw new WorkspaceConflictError({
      issue: {
        kind: WorkspaceConflictKind.SettingsSetAndClear,
        field: SettingsClearField.LaunchEntry
      },
      message: "Cannot set and clear launchEntry in the same layer"
    });
  }
  for (const field of ["preferredAdapters", "adapterOptions"] as const) {
    for (const key of settings.clear?.[field] ?? []) {
      if (Object.hasOwn(settings[field] ?? {}, key)) {
        throw new WorkspaceConflictError({
          issue: { kind: WorkspaceConflictKind.SettingsSetAndClear, field, key },
          message: `Cannot set and clear ${field}.${key} in the same layer`
        });
      }
    }
  }
  return settings;
}

export function resolveSettings(
  layers: readonly { name: string; settings: Settings }[]
): EffectiveSettings {
  const values: EffectiveSettings["values"] = {};
  const origins: Record<string, string> = Object.create(null);
  for (const layer of layers) {
    const settings = assertSettings(layer.settings);
    for (const field of ["launchEntry", "arguments"] as const) {
      if (settings[field] !== undefined) {
        if (field === "arguments") {
          values.arguments = [...settings.arguments!];
        } else {
          values.launchEntry = settings.launchEntry;
        }
        origins[field] = layer.name;
      }
    }
    for (const field of ["preferredAdapters", "adapterOptions"] as const) {
      if (!settings[field]) {
        continue;
      }
      if (field === "preferredAdapters") {
        values.preferredAdapters = {
          ...values.preferredAdapters,
          ...settings.preferredAdapters
        };
      } else {
        values.adapterOptions = {
          ...values.adapterOptions,
          ...settings.adapterOptions
        };
      }
      for (const key of Object.keys(settings[field])) {
        origins[`${field}.${key}`] = layer.name;
      }
    }
    if (settings.clear?.launchEntry) {
      values.launchEntry = null;
      origins.launchEntry = layer.name;
    }
    for (const key of settings.clear?.preferredAdapters ?? []) {
      values.preferredAdapters = { ...values.preferredAdapters, [key]: null };
      origins[`preferredAdapters.${key}`] = layer.name;
    }
    for (const key of settings.clear?.adapterOptions ?? []) {
      values.adapterOptions = { ...values.adapterOptions, [key]: null };
      origins[`adapterOptions.${key}`] = layer.name;
    }
  }
  return { values, origins };
}
