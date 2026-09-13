import { ConfigurationInputKind } from "@konogame/workspace";
import { type } from "arktype";
import { ConfigurationInvalidInputError } from "../operations/errors.ts";

export const CONFIGURATION_RECORD_BYTE_LIMIT = 1024 * 1024;

const configurationRecordText = type.string.narrow(
  (value, ctx) =>
    Buffer.byteLength(value, "utf8") <= CONFIGURATION_RECORD_BYTE_LIMIT ||
    ctx.mustBe(`at most ${CONFIGURATION_RECORD_BYTE_LIMIT} UTF-8 bytes`)
);

export function assertConfigurationRecordSize(content: string): void {
  if (configurationRecordText(content) instanceof type.errors) {
    throw ConfigurationInvalidInputError.make(
      {
        kind: ConfigurationInputKind.RecordSize,
        limit: CONFIGURATION_RECORD_BYTE_LIMIT,
        actual: Buffer.byteLength(content, "utf8")
      },
      `Configuration record exceeds UTF-8 byte limit: ${CONFIGURATION_RECORD_BYTE_LIMIT}`
    );
  }
}
