import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const processEnv: Record<string, string | undefined> =
  typeof process === "undefined" ? {} : process.env;

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  clientPrefix: "VITE_",
  // __SERVER_ENV__
  client: {},

  runtimeEnv: { ...import.meta.env, ...processEnv },

  emptyStringAsUndefined: true,
  skipValidation: !!processEnv.CI || shouldSkipValidation(),
});

function shouldSkipValidation() {
  const lifecycleEvent = processEnv.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "generate-routes";
}
