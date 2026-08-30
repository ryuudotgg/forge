import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  external: ["@libsql/client"],
  fixedExtension: false,
  format: "esm",
  noExternal: [/^@__SLUG__\//],
  outDir: "dist",
  platform: "node",
  target: "esnext",
});
