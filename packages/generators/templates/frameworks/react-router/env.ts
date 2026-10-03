import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  clientPrefix: "VITE_",
  // __SERVER_ENV__
  client: {},

  runtimeEnv: __RUNTIME_ENV__,

  emptyStringAsUndefined: true,
  skipValidation: __SKIP_VALIDATION__,
});

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
