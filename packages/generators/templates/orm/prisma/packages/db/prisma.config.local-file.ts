import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const databaseFile = fileURLToPath(new URL("../../local.db", import.meta.url));

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: `file:${databaseFile}` },
});
