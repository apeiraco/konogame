import { createFileRoute } from "@tanstack/react-router";
import { GameWallPage } from "../game/library/library.view.tsx";

export const Route = createFileRoute("/")({ component: GameWallPage });
