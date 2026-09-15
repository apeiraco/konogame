import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { it } from "@effect/vitest";
import { startDaemon } from "@konogame/daemon";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { expect } from "vitest";
import { discoveryFixture } from "../support/discovery.ts";

it.live(
  "reviews a bounded discovery in the browser, restores library focus and opens the offline API reference",
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => discoveryFixture("e2e")),
        ({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true }))
      );
      const server = yield* startDaemon({ port: 0, saveRoot: fixture.root });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a local HTTP listener");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const executablePath = process.env.KONOGAME_TEST_CHROMIUM || chromium.executablePath();
      const browser = yield* Effect.acquireRelease(
        Effect.promise(() =>
          chromium.launch(
            process.env.KONOGAME_TEST_CHROMIUM || existsSync(executablePath)
              ? { executablePath }
              : { channel: "chrome" }
          )
        ),
        (browser) => Effect.promise(() => browser.close())
      );
      yield* Effect.promise(async () => {
        const page = await browser.newPage();
        // Exercise the client bootstrap used by browsers without the resource stacks.
        await page.addInitScript(() => {
          Reflect.deleteProperty(globalThis, "AsyncDisposableStack");
          Reflect.deleteProperty(globalThis, "DisposableStack");
          Reflect.deleteProperty(globalThis, "Temporal");
        });
        const external: string[] = [];
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => {
          if (new URL(route.request().url()).origin !== origin) {
            external.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(origin);
        await page.getByRole("textbox", { name: "工作空间绝对路径" }).fill(fixture.workspace);
        await page.getByRole("button", { name: "打开", exact: true }).click();
        await page.getByRole("navigation").getByRole("link", { name: "发现游戏" }).click();
        const admissions: string[] = [];
        const previews: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/game-discovery-previews") {
            previews.push(request.method());
          }
          if (new URL(request.url()).pathname === "/api/game-admissions") {
            admissions.push(request.method());
          }
        });
        await page.getByRole("combobox", { name: "发现主机" }).click();
        await page.getByRole("option", { name: "Synthetic host" }).click();
        await page.getByRole("combobox", { name: "发现来源" }).click();
        await page.getByRole("option", { name: "steam (steam)" }).click();
        await page.getByLabel("扫描目录", { exact: true }).fill(fixture.library);
        await page.getByRole("button", { name: "生成发现预览" }).click();
        await page.getByRole("checkbox", { name: "选择 Synthetic Steam Game" }).check();
        const selected = page.getByRole("checkbox", { name: /Synthetic Steam Game/ });
        await selected.focus();
        const language = page.locator("#interface-language");
        await language.selectOption("en");
        await page.locator('html[lang="en"]').waitFor();
        expect(
          await page.getByRole("checkbox", { name: "Select Synthetic Steam Game" }).isChecked()
        ).toBe(true);
        expect(await selected.and(page.locator(":focus")).count()).toBe(1);
        expect(previews).toEqual(["POST"]);
        expect(admissions).toEqual([]);
        await language.selectOption("zh-CN");
        await page.locator('html[lang="zh-CN"]').waitFor();
        // The reviewed selection belongs to the router session and survives route remounts.
        await page.getByRole("navigation").getByRole("link", { name: "游戏库" }).click();
        await page.getByRole("navigation").getByRole("link", { name: "发现游戏" }).click();
        expect(
          await page.getByRole("checkbox", { name: "选择 Synthetic Steam Game" }).isChecked()
        ).toBe(true);
        await page.getByRole("button", { name: /审核并确认加入/ }).click();
        expect(admissions).toEqual([]);
        await page.getByRole("checkbox", { name: "我已审核选择，确认加入工作区" }).check();
        const completed = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/api/game-admissions"
        );
        await page.getByRole("button", { name: "确认加入", exact: true }).click();
        expect((await completed).status()).toBe(200);
        expect(admissions).toEqual(["POST"]);
        expect(
          await page.evaluate(
            () =>
              typeof DisposableStack === "function" &&
              typeof AsyncDisposableStack === "function" &&
              Temporal.Instant.fromEpochMilliseconds(0).epochMilliseconds === 0
          )
        ).toBe(true);
        await page.getByRole("navigation").getByRole("link", { name: "游戏库" }).click();
        const card = page.getByRole("link", { name: "查看 Synthetic Steam Game" });
        await card.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(/\/games\//);
        await language.selectOption("en");
        await page.reload();
        await page.locator('html[lang="en"]').waitFor();
        expect(await language.inputValue()).toBe("en");
        expect(await page.title()).toBe("Konogame · Library");
        await language.selectOption("zh-CN");
        await page.getByRole("button", { name: /返回游戏墙/ }).waitFor();
        // Enter from the wall again so a real history entry carries the focus target.
        await page.getByRole("button", { name: /返回游戏墙/ }).click();
        await card.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: /返回游戏墙/ }).click();
        await page.locator(':focus[aria-label="查看 Synthetic Steam Game"]').waitFor();
        const spec = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/api/openapi.json" && response.ok()
        );
        await page.goto(`${origin}/developer/openapi`);
        await spec;
        await page.getByText("Konogame local daemon API", { exact: true }).first().waitFor();
        expect(external).toEqual([]);
        expect(errors).toEqual([]);
      });
    })
);
