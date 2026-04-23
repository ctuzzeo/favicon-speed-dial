import { resolve } from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const PROJECT = process.env.PROJECT || "demo";

const rollupInput: Record<string, string> = {
  index: resolve(__dirname, "index.html"),
  settings: resolve(__dirname, "settings.html"),
};
if (PROJECT !== "demo") {
  rollupInput.background = resolve(__dirname, "src/background/index.ts");
}

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
    outDir: `dist-${PROJECT}`,
    rollupOptions: {
      input: rollupInput,
      output: {
        entryFileNames: (chunk) => {
          return chunk.name === "background" ? "[name].js" : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    target: "esnext",
    modulePreload: false,
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __CHROME__: PROJECT === "chrome",
    __FIREFOX__: PROJECT === "firefox",
    __DEMO__: PROJECT === "demo",
  },
  plugins: [react()],
  publicDir: `public/${PROJECT}`,
  resolve: {
    alias: {
      "webextension-polyfill":
        PROJECT === "demo" ? "./browser-polyfill.js" : "webextension-polyfill",
    },
  },
});
