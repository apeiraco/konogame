import { createFileRoute } from "@tanstack/react-router";
import { GameDetailPage } from "../game/library/game-detail.view.tsx";

export const Route = createFileRoute("/games/$gameId")({ component: GameDetailPage });
