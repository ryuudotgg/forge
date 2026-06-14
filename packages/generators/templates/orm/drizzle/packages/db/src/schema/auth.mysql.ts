import { snakeCase, text, timestamp, varchar } from "drizzle-orm/mysql-core";

import { users } from "./users";

export const sessions = snakeCase.table("sessions", {
  id: varchar({ length: 36 }).primaryKey(),
  userId: varchar({ length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  token: varchar({ length: 255 }).notNull().unique(),
  expiresAt: timestamp({ fsp: 3 }).notNull(),

  ipAddress: text(),
  userAgent: text(),

  createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp({ fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const accounts = snakeCase.table("accounts", {
  id: varchar({ length: 36 }).primaryKey(),
  userId: varchar({ length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

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
});

export const verifications = snakeCase.table("verifications", {
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
