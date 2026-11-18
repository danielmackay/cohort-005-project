import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Agent worktrees live under .claude/worktrees and hold full copies of the
    // repo; without this, a run from the main checkout tests every copy too.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
