import { __AUTH_ENV_NAMES__ } from "@__SLUG__/auth/env";
import { db } from "@__SLUG__/db/client";
__ADAPTER_SCHEMA_IMPORT__
__SCOPED_PLUGIN_IMPORTS__
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
// __PLUGIN_IMPORTS__
__RELATIVE_PLUGIN_IMPORTS__

const SESSION_EXPIRES_IN = 60 * 60 * 24 * 7; // 7 days
const SESSION_UPDATE_AGE = 60 * 60 * 24; // 1 day
const SESSION_CACHE_MAX_AGE = 60 * 15; // 15 minutes

const authSecret = getAuthSecret();
// __SOCIAL_DECLARATION__
const cookieDomain = normalizeCookieDomain(env.AUTH_COOKIE_DOMAIN);

const config = {
  appName: __APP_NAME__,
  secret: authSecret,
  baseURL: normalizeOrigin(env.APP_ORIGIN),
  // __TRUSTED_ORIGINS__

  database: drizzleAdapter(db, {
    provider: "__DRIZZLE_PROVIDER__",
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verifications,
__ADAPTER_MODELS__
    },
  }),
  // __EMAIL_PASSWORD__

  // __PLUGINS__

  session: {
    expiresIn: SESSION_EXPIRES_IN,
    updateAge: SESSION_UPDATE_AGE,
    cookieCache: { enabled: true, maxAge: SESSION_CACHE_MAX_AGE },
    storeSessionInDatabase: true,
  },

  // __SOCIAL_OPTION__

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

// __SOCIAL_FUNCTION__

function normalizeOrigin(origin: string) {
  return new URL(origin).origin;
}

function normalizeCookieDomain(domain: string | null | undefined) {
  const trimmed = domain?.trim();
  return trimmed ? trimmed : undefined;
}
