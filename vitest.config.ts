import { defineConfig } from "vitest/config";

const serverConditions = ["test", "node", "development|production"];

/**
 * Vitest's server defaults replace `resolve.conditions`.
 * Put `test` back on the environments that resolve test imports.
 */
function testExportCondition() {
  const resolve = { conditions: serverConditions };
  return {
    name: "konogame:test-export-condition",
    enforce: "post" as const,
    config: {
      order: "post" as const,
      handler() {
        return {
          resolve,
          ssr: { resolve },
          environments: {
            ssr: { resolve },
            __vitest__: { resolve }
          }
        };
      }
    }
  };
}

export default defineConfig({
  plugins: [testExportCondition()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          pool: "forks",
          isolate: true,
          execArgv: [],
          fileParallelism: true,
          include: ["{apps,packages,extensions,scripts}/*/src/**/__tests__/**/*.test.ts"],
          testTimeout: 10_000,
          hookTimeout: 10_000
        }
      },
      {
        test: {
          name: "integration",
          environment: "node",
          pool: "forks",
          isolate: true,
          execArgv: [],
          fileParallelism: true,
          include: [
            "{apps,packages,extensions,scripts}/*/tests/integration/**/*.test.ts",
            "tests/integration/**/*.test.ts"
          ],
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          pool: "forks",
          isolate: true,
          execArgv: [],
          fileParallelism: true,
          include: [
            "{apps,packages,extensions,scripts}/*/tests/e2e/**/*.test.ts",
            "tests/e2e/**/*.test.ts"
          ],
          testTimeout: 60_000,
          hookTimeout: 30_000
        }
      }
    ]
  }
});
