import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const url = new URL(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: url.port === "" ? 3306 : Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
});

export const db = new PrismaClient({ adapter });
