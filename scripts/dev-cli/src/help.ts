import { Help } from "@oclif/core";
import { outputContext } from "./runtime.ts";

export default class DevHelp extends Help {
  protected override log(...messages: string[]) {
    outputContext.getStore()?.(`${messages.join("\n")}\n`);
  }
}
