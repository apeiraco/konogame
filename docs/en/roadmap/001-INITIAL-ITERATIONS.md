# Initial iterations

For supported workflows, see the [architecture](../001-ARCHITECTURE.md) and [Workspace management guide](../008-WORKSPACE-MANAGEMENT.md). Each proposed increment has a dependency to validate first.

| Next increment | Prerequisite and acceptance target |
| --- | --- |
| Local save backup and restore | Choose a save format with synthetic samples. Exercise discovery, export, multi-file streaming storage and explicit import. Preview affected files and report partial failures. |
| [Additional discovery sources](003-GAME-DISCOVERY.md) | Obtain source fixtures and verify scoped scans, conflicting identities across sources and partial results. |
| [Management frontend](004-FRONTEND-EXPERIENCE.md) | Choose a local host and review candidates through real application services. Play actions depend on defined launch semantics. |
| [Optional configuration history](002-WORKSPACE-CONFIGURATION.md) | Verify recording and restore in a disposable Git repository with existing staged user changes. |

Evaluate Ludusavi save knowledge, Kopia snapshots and OpenDAL storage against concrete use cases. Patch and Notes need defined Features and Artifacts first. Trilium, Syncthing, Rclone and RustFS depend on a notes or transport use case. Durable tasks, remote access, Extension isolation and desktop packaging each need host, permission and recovery decisions.

[English](001-INITIAL-ITERATIONS.md) | [中文](../../zh/roadmap/001-INITIAL-ITERATIONS.md)
