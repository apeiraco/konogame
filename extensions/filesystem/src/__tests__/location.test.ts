import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  absoluteFilesystemLocation,
  FilesystemLocationBehavior,
  relativeFilesystemLocation
} from "../location/behavior.ts";

const behavior = new FilesystemLocationBehavior();
const windows = { platform: "windows", roots: { library: "D:/Games", alias: "d:\\games" } };
describe("filesystem Location behavior", () => {
  it.effect(
    "compares root aliases, absolute and relative values using Windows filesystem semantics",
    () =>
      Effect.gen(function* () {
        expect(
          yield* behavior.compare({
            left: relativeFilesystemLocation("library", "Synthetic/../Game"),
            right: relativeFilesystemLocation("alias", "GAME\\"),
            context: windows
          })
        ).toEqual({ status: "equal" });
        expect(
          yield* behavior.compare({
            left: relativeFilesystemLocation("library", "Game"),
            right: absoluteFilesystemLocation("d:\\GAMES\\game"),
            context: windows
          })
        ).toEqual({ status: "equal" });
        expect(
          yield* behavior.resolve({
            location: relativeFilesystemLocation("library", "Game"),
            context: windows
          })
        ).toEqual({
          status: "resolved",
          resource: {
            type: "filesystem.path",
            schemaVersion: "1.0.0",
            data: { path: "D:\\Games\\Game" }
          }
        });
      })
  );
  it.effect("keeps POSIX case meaningful", () =>
    Effect.gen(function* () {
      expect(
        yield* behavior.compare({
          left: absoluteFilesystemLocation("/Games/A"),
          right: absoluteFilesystemLocation("/Games/a"),
          context: { platform: "linux" }
        })
      ).toEqual({ status: "different" });
      expect(
        yield* behavior.compare({
          left: absoluteFilesystemLocation("/Games/a\\"),
          right: absoluteFilesystemLocation("/Games/a"),
          context: { platform: "linux" }
        })
      ).toEqual({ status: "different" });
    })
  );
  it.effect.each([
    "../Outside",
    "..\\Outside",
    "D:Game",
    "C:/Game",
    "\\Game",
    "Game:stream",
    "Game.",
    "Game "
  ])("rejects unsafe Windows relative data %s", (path) =>
    Effect.gen(function* () {
      expect(
        (yield* behavior.validate({
          location: relativeFilesystemLocation("library", path),
          context: windows
        })).status
      ).toBe("invalid");
    })
  );
  it.effect(
    "requires known absolute roots and supported schemas; foreign metadata cannot resolve",
    () =>
      Effect.gen(function* () {
        expect(
          (yield* behavior.validate({
            location: relativeFilesystemLocation("missing", "Game"),
            context: windows
          })).status
        ).toBe("invalid");
        expect(
          (yield* behavior.validate({
            location: relativeFilesystemLocation("library", "Game"),
            context: { platform: "windows", roots: { library: "relative" } }
          })).status
        ).toBe("invalid");
        expect(
          (yield* behavior.validate({
            location: { ...absoluteFilesystemLocation("D:/Game"), schemaVersion: "2.0.0" },
            context: windows
          })).status
        ).toBe("invalid");
        const unknown = {
          type: "vendor.managed",
          schemaVersion: "1.0.0",
          data: { handle: "opaque" }
        };
        expect((yield* behavior.resolve({ location: unknown })).status).toBe("unavailable");
        expect(
          (yield* behavior.compare({
            left: unknown,
            right: absoluteFilesystemLocation("D:/Game"),
            context: windows
          })).status
        ).toBe("incomparable");
      })
  );
  it.effect("uses the declared SemVer range for schema versions with build metadata", () =>
    Effect.gen(function* () {
      const location = {
        ...absoluteFilesystemLocation("D:/Game"),
        schemaVersion: "1.0.0+synthetic"
      };
      expect(yield* behavior.validate({ location, context: windows })).toEqual({
        status: "valid"
      });
      expect(
        yield* behavior.compare({
          left: location,
          right: absoluteFilesystemLocation("d:/GAME"),
          context: windows
        })
      ).toEqual({ status: "equal" });
      expect((yield* behavior.resolve({ location, context: windows })).status).toBe("resolved");
      expect(
        (yield* behavior.validate({
          location: { ...location, schemaVersion: "1.0.1" },
          context: windows
        })).status
      ).toBe("invalid");
    })
  );
});
