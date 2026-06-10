import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
