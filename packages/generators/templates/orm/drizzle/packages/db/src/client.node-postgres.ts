import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import * as schema from "@__SLUG__/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const client = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle({ client, schema, relations, casing: "snake_case" });
