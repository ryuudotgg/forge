import { env as dbEnv } from "@__SLUG__/db/env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  extends: [dbEnv],

  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
  },

  server: {
    AUTH_SECRET: z.string().trim().min(1),
    AUTH_COOKIE_DOMAIN: z.string().trim().min(1).optional(),
    AUTH_TRUSTED_PROXIES: z
      .string()
      .refine((value) => invalidProxies(value).length === 0, {
        error: (issue) =>
          `Invalid trusted proxies: ${invalidProxies(String(issue.input)).join(", ")}`,
      })
      .optional(),
    AUTH_CLIENT_IP_HEADER: z
      .string()
      .trim()
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Expected an HTTP header token")
      .optional(),

    APP_ORIGIN: z.url(),
    // __WEB_URL_SCHEMA__

    // __SOCIAL_SCHEMA__

    __PLUGIN_SCHEMA__
  },

  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,

    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
    AUTH_TRUSTED_PROXIES: process.env.AUTH_TRUSTED_PROXIES,
    AUTH_CLIENT_IP_HEADER: process.env.AUTH_CLIENT_IP_HEADER,

    APP_ORIGIN: process.env.APP_ORIGIN,
    // __WEB_URL_RUNTIME__

    // __SOCIAL_RUNTIME__

    __PLUGIN_RUNTIME__
  },

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI || shouldSkipValidation(),
});

function invalidProxies(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !isTrustedProxy(entry));
}

function isTrustedProxy(entry: string) {
  const [address, prefix, extra] = entry.split("/");
  if (!address || extra !== undefined) return false;

  const ipv4 = z.ipv4().safeParse(address).success;
  if (!ipv4 && !isPlainIPv6(address)) return false;
  if (prefix === undefined) return true;
  return /^\d+$/.test(prefix) && Number(prefix) <= (ipv4 ? 32 : 128);
}

function isPlainIPv6(address: string) {
  if (!z.ipv6().safeParse(address).success || address.includes("."))
    return false;

  const [left = "", right] = address.toLowerCase().split("::");
  const leading = left.split(":").filter(Boolean);
  const trailing = right?.split(":").filter(Boolean) ?? [];
  const missing = 8 - leading.length - trailing.length;
  const groups =
    right === undefined
      ? leading
      : [
          ...leading,
          ...Array.from({ length: missing }, () => "0"),
          ...trailing,
        ];

  const zeroed = groups.slice(0, 5).every((group) => /^0+$/.test(group));
  return !(zeroed && groups[5] === "ffff");
}

function shouldSkipValidation() {
  const lifecycleEvent = process.env.npm_lifecycle_event;
  return lifecycleEvent === "check" || lifecycleEvent === "typegen";
}
__WEB_ORIGINS__
