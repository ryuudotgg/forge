import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "~/db";

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: "pg" }),

	plugins: [nextCookies()],

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 60 * 15,
		},
	},

	account: { accountLinking: { enabled: true } },
});

export type Session = typeof auth.$Infer.Session;
