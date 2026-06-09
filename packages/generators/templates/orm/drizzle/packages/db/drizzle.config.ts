import { defineConfig } from "drizzle-kit";
import { env } from "./env";

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_DIRECT_URL },

  schema: "./src/schema/index.ts",
  out: "./src/drizzle",

  casing: "snake_case",
});
