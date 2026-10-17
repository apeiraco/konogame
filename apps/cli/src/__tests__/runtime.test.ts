import { expect, test } from "vitest";
import { interactionPolicy } from "../runtime.ts";

test("interactive precedence is explicit flag, environment, terminal with JSON and non-terminal suppression", () => {
  expect(interactionPolicy([], {}, true).interactive).toBe(true);
  expect(interactionPolicy([], { INTERACTIVE: "false" }, true).interactive).toBe(false);
  expect(interactionPolicy(["--interactive"], { INTERACTIVE: "false" }, true).interactive).toBe(
    true
  );
  for (const flag of ["--non-interactive", "--interactive=false"]) {
    expect(interactionPolicy([flag], { INTERACTIVE: "true" }, true).interactive).toBe(false);
  }
  expect(interactionPolicy(["--interactive"], {}, false).interactive).toBe(false);
  expect(interactionPolicy(["--interactive", "--json"], {}, true).interactive).toBe(false);
  expect(() => interactionPolicy(["--interactive", "--non-interactive"], {}, true)).toThrow(
    /Conflicting/
  );
  expect(interactionPolicy(["--", "--json", "--interactive=false"], {}, true)).toEqual({
    interactive: true,
    json: false
  });
});
