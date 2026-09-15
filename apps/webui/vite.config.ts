import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { daemonProxy, localDevelopmentGuard } from "./tools/local-proxy.ts";
import { signalsTracking } from "./tools/signals-transform.ts";

export default defineConfig(() => ({
  // Erase type-only imports instead of retaining empty imports of server packages.
  oxc: { typescript: { onlyRemoveTypeImports: false } },
  plugins: [
    localDevelopmentGuard(),
    signalsTracking(),
    tanstackStart({ spa: { enabled: true }, client: { entry: "./client.tsx" } }),
    react()
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": daemonProxy(Number(process.env.KONOGAME_DAEMON_PORT ?? 38417)) }
  }
}));
