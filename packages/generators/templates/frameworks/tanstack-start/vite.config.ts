import "./env";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
// __TAILWIND_IMPORT__
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [/* __TAILWIND_PLUGIN__ */ tanstackStart(), viteReact()],
});

export default config;
