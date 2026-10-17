import { packageBuild } from "../../tsdown.shared.ts";
export default packageBuild(
  ["src/main.ts", "src/commands.ts", "src/help.ts"],
  true,
  "tsconfig.app.json"
);
