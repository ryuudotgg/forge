import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import { createPolarCore } from "@polar-sh/sdk/2026-10";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { env } from "../env";

const customerPaths = new Set([
  "/customer/portal",
  "/customer/state",
  "/customer/benefits/list",
  "/customer/subscriptions/list",
  "/customer/orders/list",
]);

export function polarPlugin() {
  return polar({
    client: createPolarCore({
      accessToken: env.POLAR_ACCESS_TOKEN ?? "",
      environment: env.POLAR_SERVER ?? "sandbox",
    }),
    createCustomerOnSignUp: false,
    use: [
      checkout({ authenticatedUsersOnly: true }),
      portal(),
      webhooks({ secret: env.POLAR_WEBHOOK_SECRET ?? "" }),
    ],
  });
}

export function polarAvailability() {
  return {
    id: "polar-availability",
    hooks: {
      before: [
        {
          matcher: ({ path }) => !polarConfiguredFor(path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Polar is not configured.",
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

function polarConfiguredFor(path: string | undefined) {
  if (path === "/polar/webhooks") return Boolean(env.POLAR_WEBHOOK_SECRET);
  if (path === "/checkout" || (path !== undefined && customerPaths.has(path)))
    return Boolean(env.POLAR_ACCESS_TOKEN);

  return true;
}
