import "./env";

import { reactRouter } from "@react-router/dev/vite";
// __TAILWIND_IMPORT__
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [/* __TAILWIND_PLUGIN__ */ reactRouter()],
  resolve: { tsconfigPaths: true },
});
