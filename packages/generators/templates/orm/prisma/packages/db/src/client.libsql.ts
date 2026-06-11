import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = new PrismaClient({ adapter });
