import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const unixepochMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const users = sqliteTable("users", {
  id: text().primaryKey(),

  name: text().notNull(),
  image: text(),

  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),

  createdAt: integer({ mode: "timestamp_ms" }).notNull().default(unixepochMs),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .default(unixepochMs)
    .$onUpdate(() => new Date()),
});
