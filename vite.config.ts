import { cpSync, rmSync } from "fs";
import { resolve } from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const PROJECT = process.env.PROJECT || "demo";

/**
 * Copy the real wallpaper images into the build output. publicDir references them via
 * `public/<target>/wallpapers` -> `../wallpapers` symlinks, but a Windows git checkout
 * often materializes those as 13-byte text stubs, so the images never reach dist and
 * `/wallpapers/*` 404s at runtime. Copying here makes the build symlink-independent on
 * every OS. Runs after publicDir is copied, overwriting whatever it produced.
 * (Only affects `vite build`; `npm run dev` on Windows still serves the stub.)
 */
function copyWallpapers(): Plugin {
  return {
    name: "copy-wallpapers",
    apply: "build",
    closeBundle() {
      const dest = resolve(__dirname, `dist-${PROJECT}/wallpapers`);
      rmSync(dest, { recursive: true, force: true });
      cpSync(resolve(__dirname, "public/wallpapers"), dest, { recursive: true });
    },
  };
}

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
  plugins: [react(), copyWallpapers()],
  publicDir: `public/${PROJECT}`,
  resolve: {
    alias: {
      "webextension-polyfill":
        PROJECT === "demo"
          ? resolve(__dirname, "src/demo-webextension-polyfill.ts")
          : "webextension-polyfill",
    },
  },
});
