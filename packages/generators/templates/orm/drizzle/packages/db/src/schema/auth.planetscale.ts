// PlanetScale ships without foreign key constraints by default, so the user
// references stay unenforced and the lookup indexes are declared by hand.
import { index, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar({ length: 36 }).primaryKey(),
    userId: varchar({ length: 36 }).notNull(),

    token: varchar({ length: 255 }).notNull().unique(),
    expiresAt: timestamp({ fsp: 3 }).notNull(),

    ipAddress: text(),
    userAgent: text(),

    createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp({ fsp: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = mysqlTable(
  "accounts",
  {
    id: varchar({ length: 36 }).primaryKey(),
    userId: varchar({ length: 36 }).notNull(),

    accountId: text().notNull(),
    providerId: text().notNull(),

    accessToken: text(),
    accessTokenExpiresAt: timestamp({ fsp: 3 }),

    refreshToken: text(),
    refreshTokenExpiresAt: timestamp({ fsp: 3 }),

    scope: text(),

    createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp({ fsp: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = mysqlTable("verifications", {
  id: varchar({ length: 36 }).primaryKey(),
  identifier: varchar({ length: 255 }).notNull(),

  value: text().notNull(),
  expiresAt: timestamp({ fsp: 3 }).notNull(),

  createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp({ fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
