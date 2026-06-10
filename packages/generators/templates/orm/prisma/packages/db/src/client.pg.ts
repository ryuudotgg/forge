import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
