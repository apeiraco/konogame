import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "../game/discovery/discovery.view.tsx";

export const Route = createFileRoute("/discovery")({ component: DiscoveryPage });
