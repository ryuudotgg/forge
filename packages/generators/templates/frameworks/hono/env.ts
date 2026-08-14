import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),

    WEB_URL: z.url().default("__WEB_ORIGIN__"),
  },

  runtimeEnv: process.env,

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI || shouldSkipValidation(),
});

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
