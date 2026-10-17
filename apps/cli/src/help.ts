import { Help } from "@oclif/core";
import { runtime } from "./runtime.ts";

export default class CliHelp extends Help {
  protected override log(...messages: string[]): void {
    runtime().stdout(`${messages.join("\n")}\n`);
  }
}
