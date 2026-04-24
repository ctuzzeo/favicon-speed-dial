import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["verbose"],
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
    __CHROME__: false,
    __FIREFOX__: false,
    __DEMO__: true,
  },
});
