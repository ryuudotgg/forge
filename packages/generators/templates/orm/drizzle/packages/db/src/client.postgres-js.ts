import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Prepared statements are not supported in the pooler's transaction mode.
const client = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle({ client, relations });
