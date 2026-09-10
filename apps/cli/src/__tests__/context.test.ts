import { Cause, Effect } from "effect";
import { expect, test } from "vitest";
import { CLI_CONTEXT, interactionPolicy, required } from "../context.ts";

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

function runRequired(value: string | undefined, interactive: boolean, prompted: string[]) {
  return Effect.exit(
    required(value, "feature").pipe(
      Effect.provideService(CLI_CONTEXT, {
        interactive,
        json: true,
        prompts: {
          text: (message) =>
            Effect.sync(() => {
              prompted.push(message);
              return "prompted";
            }),
          select: () => Effect.die(new Error("Unexpected select prompt")),
          confirm: () => Effect.die(new Error("Unexpected confirm prompt"))
        },
        stdout: () => Effect.void,
        stderr: () => Effect.void
      })
    )
  );
}

test("required prompts only on an interactive terminal and otherwise reports the missing argument", async () => {
  const prompted: string[] = [];
  const provided = await Effect.runPromise(runRequired("value", false, prompted));
  expect(provided._tag).toBe("Success");
  const missing = await Effect.runPromise(runRequired(undefined, false, prompted));
  expect(missing._tag).toBe("Failure");
  if (missing._tag === "Failure") {
    expect(Cause.prettyErrors(missing.cause)[0]?.message).toContain(
      "Missing required argument: feature"
    );
  }
  expect(prompted).toEqual([]);
  const interactive = await Effect.runPromise(runRequired(undefined, true, prompted));
  expect(interactive._tag).toBe("Success");
  expect(prompted).toEqual(["feature"]);
});
