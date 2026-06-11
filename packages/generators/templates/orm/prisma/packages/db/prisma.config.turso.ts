import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Prisma Migrate can't reach Turso over libsql://, so migrations run against
// this scratch file and are applied to Turso with
// `turso db shell <database-name> < prisma/migrations/<migration>/migration.sql`.
const databaseFile = fileURLToPath(new URL("prisma/local.db", import.meta.url));

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: `file:${databaseFile}` },
});
