import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: text().primaryKey(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: boolean().notNull().default(false),
	image: text(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const sessions = pgTable("sessions", {
	id: text().primaryKey(),
	userId: text()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	token: text().notNull().unique(),
	expiresAt: timestamp({ withTimezone: true }).notNull(),
	ipAddress: text(),
	userAgent: text(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const accounts = pgTable("accounts", {
	id: text().primaryKey(),
	userId: text()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accountId: text().notNull(),
	providerId: text().notNull(),
	accessToken: text(),
	accessTokenExpiresAt: timestamp({ withTimezone: true }),
	refreshToken: text(),
	refreshTokenExpiresAt: timestamp({ withTimezone: true }),
	scope: text(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const verifications = pgTable("verifications", {
	id: text().primaryKey(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true }).notNull(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});
