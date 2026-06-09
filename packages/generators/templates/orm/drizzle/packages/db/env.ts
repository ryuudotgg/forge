import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  server: {
    DATABASE_URL: z.url(),
    DATABASE_DIRECT_URL: z.url(),
  },

  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
  },

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI || shouldSkipValidation(),
});

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
