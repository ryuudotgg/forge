import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
