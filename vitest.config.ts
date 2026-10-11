import { defineConfig } from "vitest/config"
import { WxtVitest } from "wxt/testing/vitest-plugin"

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "happy-dom",
    // WXT's fake browser keeps storage in memory; reset it between tests
    setupFiles: ["test/unit/setup.ts"],
  },
})
