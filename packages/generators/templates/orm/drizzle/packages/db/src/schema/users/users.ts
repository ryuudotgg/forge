import { boolean, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

export const users = snakeCase.table("users", {
  id: text().primaryKey(),

  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),

  name: text().notNull(),
  image: text(),
  // __USER_PLUGIN_FIELDS__

  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
