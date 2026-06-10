import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import * as schema from "@__SLUG__/db/schema";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// PlanetScale serves Neon's HTTP protocol on the database host itself.
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;
const client = neon(env.DATABASE_URL);

export const db = drizzle({ client, schema, relations, casing: "snake_case" });
