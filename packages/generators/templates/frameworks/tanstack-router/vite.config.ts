import "./env";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
// __TAILWIND_IMPORT__
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    /* __TAILWIND_PLUGIN__ */ tanstackRouter({
      autoCodeSplitting: true,
      target: "react",
    }),
    viteReact(),
  ],
});

export default config;
