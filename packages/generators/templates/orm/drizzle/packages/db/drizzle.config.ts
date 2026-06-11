import { defineConfig } from "drizzle-kit";
import { env } from "./env";

export default defineConfig({
  dialect: "__KIT_DIALECT__",
  dbCredentials: { __KIT_CREDENTIALS__ },

  schema: "./src/schema/index.ts",
  out: "./src/drizzle",

  casing: "snake_case",
});
