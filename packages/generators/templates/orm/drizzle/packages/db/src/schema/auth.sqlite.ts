import { sql } from "drizzle-orm";
import { integer, snakeCase, text } from "drizzle-orm/sqlite-core";

import { users } from "./users";

const unixepochMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const sessions = snakeCase.table("sessions", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  token: text().notNull().unique(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),

  ipAddress: text(),
  userAgent: text(),

  createdAt: integer({ mode: "timestamp_ms" }).notNull().default(unixepochMs),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .default(unixepochMs)
    .$onUpdate(() => new Date()),
});

export const accounts = snakeCase.table("accounts", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  accountId: text().notNull(),
  providerId: text().notNull(),

  accessToken: text(),
  accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),

  refreshToken: text(),
  refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),

  scope: text(),

  createdAt: integer({ mode: "timestamp_ms" }).notNull().default(unixepochMs),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .default(unixepochMs)
    .$onUpdate(() => new Date()),
});

export const verifications = snakeCase.table("verifications", {
  id: text().primaryKey(),
  identifier: text().notNull(),

  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),

  createdAt: integer({ mode: "timestamp_ms" }).notNull().default(unixepochMs),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .default(unixepochMs)
    .$onUpdate(() => new Date()),
});
