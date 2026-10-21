import {
  boolean,
  snakeCase,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = snakeCase.table("users", {
  id: varchar({ length: 36 }).primaryKey(),

  email: varchar({ length: 255 }).notNull().unique(),
  emailVerified: boolean().notNull().default(false),

  name: varchar({ length: 255 }).notNull(),
  image: text(),
  // __USER_PLUGIN_FIELDS__

  createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp({ fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
