import { boolean, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: varchar({ length: 36 }).primaryKey(),

  name: varchar({ length: 255 }).notNull(),
  image: text(),

  email: varchar({ length: 255 }).notNull().unique(),
  emailVerified: boolean().notNull().default(false),

  createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp({ fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
