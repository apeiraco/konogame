import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  absoluteFilesystemLocation,
  relativeFilesystemLocation
} from "@konogame/extension-filesystem";
import {
  type DiscoveryObservation,
  discoverySourceCapability,
  GameCapability,
  type GameDiscoveryPort,
  GameOperation,
  GamePort,
  gameModule
} from "@konogame/game";
import {
  DiscoveryDisposition,
  GameDiscoveryConflictError,
  GameDiscoveryConflictKind,
  GameDiscoveryInputError,
  GameDiscoveryInputKind,
  GameDiscoveryMismatchKind,
  GameDiscoveryNotFoundError,
  GameDiscoveryReviewMismatchError,
  gameDiscoveryPreviewSchema
} from "@konogame/game/admission";
import {
  type AdapterDescriptor,
  DECLARATION_PROTOCOL_VERSION,
  SchemaValidationError
} from "@konogame/infrastructure/contracts";
import {
  HistoryMode,
  HostPlatform,
  ImportStatus,
  RecordKind,
  SourceStatus,
  WORKSPACE_SCHEMA,
  WorkspaceCapability,
  type WorkspaceConfigurationPort,
  WorkspaceOperation,
  WorkspacePort,
  type WorkspaceSnapshot,
  workspaceModule
} from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { assertFailure, assertInterrupted } from "../../../../tests/support/assertions.ts";
import { createApplication } from "../../../../tests/support/use-cases.ts";

const refs = (id: string) => [{ authority: "example", kind: "product", key: { id } }];
const identity = (id: string) => [
  { issuer: "synthetic", purpose: "game" as const, value: `product:${id}` }
];
function fixture(kind = "standalone", readOnly = false) {
  return Effect.gen(function* () {
    const hostId = uuidv7();
    const snapshot: WorkspaceSnapshot = {
      workspace: {
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Workspace,
        id: uuidv7(),
        name: "Synthetic",
        defaults: {},
        history: { mode: HistoryMode.Disabled }
      },
      hosts: [
        {
          schemaVersion: WORKSPACE_SCHEMA,
          kind: RecordKind.Host,
          id: hostId,
          uniformName: "Lab",
          label: "Lab",
          platform: HostPlatform.Windows,
          roots: { library: "D:/Games" },
          defaults: {},
          gameOverrides: {},
          sources: [{ id: "local", kind, status: SourceStatus.Configured }]
        }
      ],
      games: [],
      installations: [],
      revision: "one"
    };
    let candidates: DiscoveryObservation[] = [
      {
        observationKey: "observed-a",
        title: "Same title",
        location: absoluteFilesystemLocation("D:/Games/A"),
        externalRefs: kind === "identified" ? refs("42") : [],
        ...(kind === "identified" ? { externalIdentities: identity("42") } : {}),
        evidence: [{ kind: "directory", path: "D:/Games/A", fingerprint: "sha256:one" }]
      }
    ];
    let writes = 0;
    let scans = 0;
    const configuration: WorkspaceConfigurationPort = {
      read() {
        return Effect.sync(() => {
          return structuredClone(snapshot);
        });
      },
      import(input) {
        return Effect.sync(() => {
          writes++;
          assert.equal(input.expectedRevision, snapshot.revision);
          snapshot.games.push(...input.games);
          snapshot.installations.push(...input.installations);
          snapshot.revision = "two";
          return {
            status: ImportStatus.Imported,
            operationId: input.operationId,
            revision: "two",
            gameIds: input.games.map((item) => item.id),
            installationIds: input.installations.map((item) => item.id)
          };
        });
      }
    };
    const discovery: GameDiscoveryPort = {
      discover() {
        return Effect.sync(() => {
          scans++;
          return { observations: candidates, diagnostics: [] };
        });
      }
    };
    const configDescriptor: AdapterDescriptor = {
      id: "synthetic.configuration",
      owner: { kind: "extension", id: "synthetic" },
      port: WorkspacePort.Configuration,
      declarationProtocolRange: DECLARATION_PROTOCOL_VERSION,
      portVersionRange: "^0.2.0",
      operations: [WorkspaceOperation.Read, WorkspaceOperation.Import],
      capabilities: [WorkspaceCapability.Records, WorkspaceCapability.Import]
    };
    const discoveryDescriptor: AdapterDescriptor = {
      id: "synthetic.discovery",
      owner: { kind: "extension", id: "synthetic" },
      port: GamePort.Discovery,
      declarationProtocolRange: DECLARATION_PROTOCOL_VERSION,
      portVersionRange: "^0.3.0",
      operations: [GameOperation.Discover],
      capabilities: [
        GameCapability.LocalDiscovery,
        GameCapability.ScopedDiscovery,
        discoverySourceCapability(kind)
      ]
    };
    if (readOnly) {
      configDescriptor.operations = [WorkspaceOperation.Read];
      configDescriptor.capabilities = [WorkspaceCapability.Records];
      delete configuration.import;
    }
    const app = yield* createApplication(
      [workspaceModule, gameModule],
      [configDescriptor, discoveryDescriptor],
      new Map(),
      new Map([[configDescriptor.id, configuration]]),
      new Map(),
      new Map([[discoveryDescriptor.id, discovery]]),
      { temporal: { now: () => Effect.succeed(Temporal.Instant.from("2026-10-17T00:00:00Z")) } }
    );
    const request = {
      root: "synthetic-workspace",
      hostId,
      sourceId: "local",
      scope: { paths: ["D:/Games"], maxDepth: 1, exclude: [] }
    };
    return {
      app,
      request,
      snapshot,
      configuration,
      discoveryDescriptor,
      get candidates() {
        return candidates;
      },
      set candidates(value) {
        candidates = value;
      },
      get writes() {
        return writes;
      },
      get scans() {
        return scans;
      }
    };
  });
}
it.effect(
  "preview is read only and confirmation creates UUIDv7 records; fresh repeat is no-op",
  () =>
    Effect.gen(function* () {
      const lab = yield* fixture();
      const preview = yield* lab.app.admission.preview(lab.request);
      assert.equal(lab.writes, 0);
      assert.equal(preview.candidates[0]?.disposition, DiscoveryDisposition.NewGame);
      const result = yield* lab.app.admission.import({
        root: lab.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      });
      assert.equal(result.status, ImportStatus.Imported);
      assert.equal(lab.snapshot.games.length, 1);
      assert.equal(lab.snapshot.installations[0]?.gameId, lab.snapshot.games[0]?.id);
      assert.deepEqual(lab.snapshot.installations[0]?.launchEntries, []);
      assert.match(lab.snapshot.games[0]?.id ?? "", /^[0-9a-f-]{14}7/);
      const repeated = yield* lab.app.admission.preview(lab.request);
      assert.equal(repeated.candidates[0]?.disposition, DiscoveryDisposition.ExistingInstallation);
      assert.equal(
        (yield* lab.app.admission.import({
          root: lab.request.root,
          preview: repeated,
          selectedCandidateIds: [repeated.candidates[0]!.candidateId]
        })).status,
        ImportStatus.Unchanged
      );
      assert.equal(lab.writes, 1);
    })
);
it.effect(
  "same titles remain distinct without portable identity; repeated external identity shares one Game",
  () =>
    Effect.gen(function* () {
      for (const kind of ["standalone", "identified"]) {
        const lab = yield* fixture(kind);
        lab.candidates = [
          ...lab.candidates,
          {
            ...lab.candidates[0]!,
            observationKey: "observed-b",
            location: absoluteFilesystemLocation("D:/Games/B")
          }
        ];
        const preview = yield* lab.app.admission.preview(lab.request);
        yield* lab.app.admission.import({
          root: lab.request.root,
          preview,
          selectedCandidateIds: preview.candidates.map((candidate) => candidate.candidateId)
        });
        assert.equal(lab.snapshot.games.length, kind === "identified" ? 1 : 2);
        assert.equal(lab.snapshot.installations.length, 2);
      }
    })
);
it.effect("stable external identity reuses existing Game at a different installation path", () =>
  Effect.gen(function* () {
    const lab = yield* fixture("identified");
    lab.snapshot.games.push({
      schemaVersion: WORKSPACE_SCHEMA,
      kind: RecordKind.Game,
      id: uuidv7(),
      title: "Other display name",
      uniformName: "Other display name",
      externalRefs: refs("42"),
      externalIdentities: identity("42"),
      settings: {}
    });
    const preview = yield* lab.app.admission.preview(lab.request);
    assert.equal(preview.candidates[0]?.disposition, DiscoveryDisposition.ReuseGame);
    yield* lab.app.admission.import({
      root: lab.request.root,
      preview,
      selectedCandidateIds: [preview.candidates[0]!.candidateId]
    });
    assert.equal(lab.snapshot.games.length, 1);
    assert.equal(lab.snapshot.installations[0]?.gameId, lab.snapshot.games[0]?.id);
  })
);
it.effect(
  "rejects extra fields, modified plans and independently anchored root before scanning",
  () =>
    Effect.gen(function* () {
      const lab = yield* fixture();
      const preview = yield* lab.app.admission.preview(lab.request);
      assert.throws(() => gameDiscoveryPreviewSchema.assert({ ...preview, records: [] }));
      for (const input of [
        {
          root: lab.request.root,
          preview: { ...preview, candidates: [{ ...preview.candidates[0], title: "Injected" }] }
        },
        { root: "another-workspace", preview },
        {
          root: lab.request.root,
          preview: { ...preview, scope: { ...preview.scope, paths: ["../outside"] } }
        }
      ]) {
        yield* assertFailure(
          lab.app.admission.import({
            ...input,
            selectedCandidateIds: [preview.candidates[0]!.candidateId]
          })
        );
      }
      assert.equal(lab.scans, 1);
      assert.equal(lab.writes, 0);
    })
);
it.effect("Workspace revision and source evidence changes invalidate confirmation", () =>
  Effect.gen(function* () {
    for (const changeRevision of [true, false]) {
      const lab = yield* fixture();
      const preview = yield* lab.app.admission.preview(lab.request);
      if (changeRevision) {
        lab.snapshot.revision = "external-edit";
      } else {
        lab.candidates[0]!.evidence[0]!.fingerprint = "sha256:changed";
      }
      const error = yield* Effect.flip(
        lab.app.admission.import({
          root: lab.request.root,
          preview,
          selectedCandidateIds: [preview.candidates[0]!.candidateId]
        })
      );
      assert.ok(error instanceof GameDiscoveryReviewMismatchError);
      assert.equal(error.issue.kind, GameDiscoveryMismatchKind.Stale);
      assert.equal(error.issue.expectedRevision, preview.revision);
      assert.equal(error.issue.actualRevision, lab.snapshot.revision);
      assert.notEqual(error.issue.expected, error.issue.actual);
      assert.match(error.message, /stale/);
      assert.equal(lab.writes, 0);
    }
  })
);
it.effect(
  "source capability and incompatible explicit preference reject before discovery I/O",
  () =>
    Effect.gen(function* () {
      const lab = yield* fixture();
      lab.snapshot.hosts[0]!.sources[0]!.kind = "identified";
      yield* assertFailure(lab.app.admission.preview(lab.request), /No adapter/);
      yield* assertFailure(
        lab.app.admission.preview({ ...lab.request, preferredAdapterId: "missing" }),
        /preference/
      );
      assert.equal(lab.scans, 0);
    })
);
it.effect(
  "existing relative installation matches normalized Windows casing and conflicting source is visible",
  () =>
    Effect.gen(function* () {
      const lab = yield* fixture();
      const gameId = uuidv7();
      lab.snapshot.games.push({
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Game,
        id: gameId,
        title: "A",
        uniformName: "A",
        externalRefs: [],
        settings: {}
      });
      lab.snapshot.installations.push({
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Installation,
        id: uuidv7(),
        uniformName: "A",
        gameId,
        hostId: lab.request.hostId,
        sourceId: "local",
        location: relativeFilesystemLocation("library", "a"),
        launchEntries: [],
        settings: {}
      });
      assert.equal(
        (yield* lab.app.admission.preview(lab.request)).candidates[0]?.disposition,
        DiscoveryDisposition.ExistingInstallation
      );
      lab.snapshot.hosts[0]!.sources.push({
        id: "other",
        kind: "identified",
        status: SourceStatus.Configured
      });
      lab.snapshot.installations[0]!.sourceId = "other";
      const preview = yield* lab.app.admission.preview(lab.request);
      assert.equal(preview.candidates[0]?.disposition, DiscoveryDisposition.Conflict);
      const conflict = yield* Effect.flip(
        lab.app.admission.import({
          root: lab.request.root,
          preview,
          selectedCandidateIds: [preview.candidates[0]!.candidateId]
        })
      );
      assert.ok(conflict instanceof GameDiscoveryConflictError);
      assert.equal(conflict.issue.kind, GameDiscoveryConflictKind.Candidate);
      assert.equal(conflict.issue.candidateId, preview.candidates[0]!.candidateId);
      assert.equal(conflict.issue.hostId, lab.request.hostId);
      assert.equal(conflict.issue.sourceId, lab.request.sourceId);
      assert.match(conflict.message, /Conflicting/);
      assert.equal(lab.writes, 0);
    })
);
it.effect("a different external identity at an occupied installation is an identity conflict", () =>
  Effect.gen(function* () {
    const lab = yield* fixture("identified");
    const gameId = uuidv7();
    lab.snapshot.games.push({
      schemaVersion: WORKSPACE_SCHEMA,
      kind: RecordKind.Game,
      id: gameId,
      title: "A",
      uniformName: "A",
      externalRefs: refs("999"),
      externalIdentities: identity("999"),
      settings: {}
    });
    lab.snapshot.installations.push({
      schemaVersion: WORKSPACE_SCHEMA,
      kind: RecordKind.Installation,
      id: uuidv7(),
      uniformName: "A",
      gameId,
      hostId: lab.request.hostId,
      sourceId: "local",
      location: absoluteFilesystemLocation("D:/Games/A"),
      launchEntries: [],
      settings: {}
    });
    assert.equal(
      (yield* lab.app.admission.preview(lab.request)).candidates[0]?.disposition,
      DiscoveryDisposition.Conflict
    );
  })
);
it.effect("rejects unknown and duplicate selections and conflicting observation keys", () =>
  Effect.gen(function* () {
    const lab = yield* fixture();
    const preview = yield* lab.app.admission.preview(lab.request);
    const unknown = yield* Effect.flip(
      lab.app.admission.import({
        root: lab.request.root,
        preview,
        selectedCandidateIds: ["missing"]
      })
    );
    assert.ok(unknown instanceof GameDiscoveryNotFoundError);
    assert.deepEqual(unknown.issue, { kind: "candidate", id: "missing" });
    const duplicate = yield* Effect.flip(
      lab.app.admission.import({
        root: lab.request.root,
        preview,
        selectedCandidateIds: [
          preview.candidates[0]!.candidateId,
          preview.candidates[0]!.candidateId
        ]
      })
    );
    assert.ok(duplicate instanceof GameDiscoveryInputError);
    assert.deepEqual(duplicate.issue, {
      kind: GameDiscoveryInputKind.DuplicateCandidates,
      candidateIds: [preview.candidates[0]!.candidateId]
    });
    const empty = yield* Effect.flip(
      lab.app.admission.import({ root: lab.request.root, preview, selectedCandidateIds: [] })
    );
    assert.ok(empty instanceof SchemaValidationError);
    assert.equal(empty.schemaId, "game.discovery-selected-candidate-ids");
    lab.candidates.push({ ...lab.candidates[0]!, title: "Conflicting observation" });
    const conflict = yield* Effect.flip(lab.app.admission.preview(lab.request));
    assert.ok(conflict instanceof GameDiscoveryConflictError);
    assert.deepEqual(conflict.issue, {
      kind: GameDiscoveryConflictKind.ObservationKey,
      observationKey: "observed-a",
      hostId: lab.request.hostId,
      sourceId: lab.request.sourceId
    });
    assert.match(conflict.message, /Conflicting discovery observation key/);
    assert.equal(lab.writes, 0);
  })
);
it.effect("aborted preview and confirmation never write", () =>
  Effect.gen(function* () {
    const lab = yield* fixture();
    const preview = yield* lab.app.admission.preview(lab.request);
    yield* assertInterrupted(lab.app.admission.preview(lab.request));
    yield* assertInterrupted(
      lab.app.admission.import({
        root: lab.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      })
    );
    assert.equal(lab.writes, 0);
  })
);
it.effect("read-only configuration capability permits preview and reports import unavailable", () =>
  Effect.gen(function* () {
    const lab = yield* fixture("standalone", true);
    const preview = yield* lab.app.admission.preview(lab.request);
    assert.equal(preview.candidates.length, 1);
    assert.equal(preview.adapterResolutionPlan.unavailable[0]?.feature, "workspace.import");
    yield* assertFailure(
      lab.app.admission.import({
        root: lab.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      }),
      /No compatible adapter/
    );
    assert.equal(lab.writes, 0);
  })
);

it.effect("review selectors expose the specific mismatch before any rescan or write", () =>
  Effect.gen(function* () {
    const lab = yield* fixture();
    const preview = yield* lab.app.admission.preview(lab.request);
    const otherHost = uuidv7();
    const otherOperation = uuidv7();
    const mismatches = [
      {
        input: { root: "other-workspace" },
        kind: GameDiscoveryMismatchKind.Root,
        expected: preview.root,
        actual: "other-workspace"
      },
      {
        input: { hostId: otherHost },
        kind: GameDiscoveryMismatchKind.Host,
        expected: preview.hostId,
        actual: otherHost
      },
      {
        input: { sourceId: "other-source" },
        kind: GameDiscoveryMismatchKind.Source,
        expected: preview.sourceId,
        actual: "other-source"
      },
      {
        input: { operationId: otherOperation },
        kind: GameDiscoveryMismatchKind.OperationId,
        expected: preview.operationId,
        actual: otherOperation
      }
    ];
    for (const mismatch of mismatches) {
      const error = yield* Effect.flip(
        lab.app.admission.import({
          root: lab.request.root,
          preview,
          selectedCandidateIds: [preview.candidates[0]!.candidateId],
          ...mismatch.input
        })
      );
      assert.ok(error instanceof GameDiscoveryReviewMismatchError);
      assert.deepEqual(error.issue, {
        reviewKind: "game-discovery",
        kind: mismatch.kind,
        expected: mismatch.expected,
        actual: mismatch.actual
      });
    }
    assert.equal(lab.scans, 1);
    assert.equal(lab.writes, 0);
  })
);
