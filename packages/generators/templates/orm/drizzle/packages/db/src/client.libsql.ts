import { env } from "@__SLUG__/db/env";
import { relations } from "@__SLUG__/db/relations";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const client = createClient({ url: env.DATABASE_URL });
export const db = drizzle({ client, relations });
