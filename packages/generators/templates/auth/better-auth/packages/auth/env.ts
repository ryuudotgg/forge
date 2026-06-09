import { env as dbEnv } from "@__SLUG__/db/env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  extends: [dbEnv],

  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  server: {
    AUTH_SECRET: z.string().trim().min(1),
    AUTH_COOKIE_DOMAIN: z.string().trim().min(1).optional(),

    APP_ORIGIN: z.url(),

    AUTH_GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),

    AUTH_APPLE_CLIENT_ID: z.string().trim().min(1).optional(),
    AUTH_APPLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
  },

  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,

    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,

    APP_ORIGIN: process.env.APP_ORIGIN,

    AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID,
    AUTH_GOOGLE_CLIENT_SECRET: process.env.AUTH_GOOGLE_CLIENT_SECRET,

    AUTH_APPLE_CLIENT_ID: process.env.AUTH_APPLE_CLIENT_ID,
    AUTH_APPLE_CLIENT_SECRET: process.env.AUTH_APPLE_CLIENT_SECRET,
  },

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI || shouldSkipValidation(),
});

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
