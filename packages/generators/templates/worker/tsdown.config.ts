import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  fixedExtension: false,
  format: "esm",
  noExternal: [/^@__SLUG__\//],
  outDir: "dist",
  platform: "node",
  target: "esnext",
});
