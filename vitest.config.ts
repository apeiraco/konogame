import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["{apps,packages,extensions,scripts}/*/src/**/__tests__/**/*.test.ts"],
          testTimeout: 15_000,
          hookTimeout: 15_000
        }
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["{apps,packages,extensions,scripts}/*/tests/integration/**/*.test.ts"],
          testTimeout: 15_000,
          hookTimeout: 15_000
        }
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          include: [
            "{apps,packages,extensions,scripts}/*/tests/e2e/**/*.test.ts",
            "tests/e2e/**/*.test.ts"
          ],
          testTimeout: 15_000,
          hookTimeout: 15_000
        }
      }
    ]
  }
});
