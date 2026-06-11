import { env } from "@__SLUG__/auth/env";
import { db } from "@__SLUG__/db/client";
import { accounts, sessions, users, verifications } from "@__SLUG__/db/schema";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

const SESSION_EXPIRES_IN = 60 * 60 * 24 * 7; // 7 days
const SESSION_UPDATE_AGE = 60 * 60 * 24; // 1 day
const SESSION_CACHE_MAX_AGE = 60 * 15; // 15 minutes

const authSecret = getAuthSecret();
const socialProviders = getSocialProviders();
const cookieDomain = normalizeCookieDomain(env.AUTH_COOKIE_DOMAIN);

const config = {
  secret: authSecret,
  baseURL: normalizeOrigin(env.APP_ORIGIN),

  database: drizzleAdapter(db, {
    provider: "__DRIZZLE_PROVIDER__",
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verifications,
    },
  }),

  plugins: [nextCookies()],

  session: {
    expiresIn: SESSION_EXPIRES_IN,
    updateAge: SESSION_UPDATE_AGE,
    cookieCache: { enabled: true, maxAge: SESSION_CACHE_MAX_AGE },
    storeSessionInDatabase: true,
  },

  ...(socialProviders ? { socialProviders } : {}),

  account: { accountLinking: { enabled: true } },

  advanced: {
    useSecureCookies: env.NODE_ENV !== "development",
    ...(cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }
      : {}),
  },
} satisfies BetterAuthOptions;

export const auth = betterAuth(config);

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"];

function getAuthSecret() {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  throw new Error("AUTH_SECRET is required");
}

function getSocialProviders() {
  const google =
    env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.AUTH_GOOGLE_CLIENT_ID,
          clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
          redirectURI: `${normalizeOrigin(env.APP_ORIGIN)}/api/auth/callback/google`,
        }
      : null;

  const apple =
    env.AUTH_APPLE_CLIENT_ID && env.AUTH_APPLE_CLIENT_SECRET
      ? {
          clientId: env.AUTH_APPLE_CLIENT_ID,
          clientSecret: env.AUTH_APPLE_CLIENT_SECRET,
          redirectURI: `${normalizeOrigin(env.APP_ORIGIN)}/api/auth/callback/apple`,
        }
      : null;

  if (!google && !apple) return null;

  return {
    ...(apple ? { apple } : {}),
    ...(google ? { google } : {}),
  };
}

function normalizeOrigin(origin: string) {
  return new URL(origin).origin;
}

function normalizeCookieDomain(domain: string | null | undefined) {
  const trimmed = domain?.trim();
  return trimmed ? trimmed : undefined;
}
