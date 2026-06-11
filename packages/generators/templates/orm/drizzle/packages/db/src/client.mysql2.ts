import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import * as schema from "@__SLUG__/db/schema";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";

const client = createPool({ uri: env.DATABASE_URL, timezone: "Z" });

export const db = drizzle({
  client,
  schema,
  relations,
  casing: "snake_case",
  mode: "default",
});
