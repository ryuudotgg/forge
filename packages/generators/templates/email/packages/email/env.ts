import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
  },

  server: {
    EMAIL_FROM: z.string().trim().min(1).optional(),
    __KEY__: z.string().trim().min(1).optional(),
  },

  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,
    EMAIL_FROM: process.env.EMAIL_FROM,
    __KEY__: process.env.__KEY__,
  },

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI || shouldSkipValidation(),
});

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
