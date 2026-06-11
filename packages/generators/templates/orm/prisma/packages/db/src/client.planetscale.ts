import { env } from "@__SLUG__/db/env";
import { PrismaClient } from "@__SLUG__/db/generated/prisma/client";
import { PrismaPlanetScale } from "@prisma/adapter-planetscale";

const adapter = new PrismaPlanetScale({ url: env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
