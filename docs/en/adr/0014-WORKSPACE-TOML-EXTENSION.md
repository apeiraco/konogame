# ADR 0014 · Workspace TOML as a bundled Extension

Accepted on 2026-11-03. Updates persistence ownership in [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md).

Workspace owns the Feature declarations, configuration Port, UUID identity and filename codec. The bundled `konogame.workspace-toml` Extension supplies `workspace-toml.configuration` and releases independently. CLI and daemon select the configuration source before reading Workspace records.

The Module registers independently so its Features remain discoverable when no configuration Adapter is available. The Extension implements TOML byte preservation, file publication, writer coordination and recovery. It declares a fixed compatible Port range in project metadata. Alternative Adapters can reuse the same domain rules.

The host injects `@konogame/node-installed-extension-source` when installed roots are configured. Discovery must be available before the catalog can select and activate those packages, so the source ships with the core host.

Explicit Adapter preferences and scripts must use `workspace-toml.configuration`. Existing previews must be regenerated before apply. Workspace record layout, UUID projection and Port versions retain their existing definitions.

[English](0014-WORKSPACE-TOML-EXTENSION.md) | [中文](../../zh/adr/0014-WORKSPACE-TOML-EXTENSION.md)
