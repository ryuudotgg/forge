import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import * as schema from "@__SLUG__/db/schema";
import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";

const client = new Client({ url: env.DATABASE_URL });
export const db = drizzle({ client, schema, relations, casing: "snake_case" });
