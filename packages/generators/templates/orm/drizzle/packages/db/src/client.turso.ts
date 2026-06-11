import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import * as schema from "@__SLUG__/db/schema";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = drizzle({ client, schema, relations, casing: "snake_case" });
