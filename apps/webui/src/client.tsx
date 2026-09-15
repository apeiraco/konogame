import { bootstrapBrowserApp } from "./app/browser-polyfills.ts";

// This is Start's browser entry; importing the application waits for standard APIs.
await bootstrapBrowserApp(() => import("./app/start-client.tsx"));
