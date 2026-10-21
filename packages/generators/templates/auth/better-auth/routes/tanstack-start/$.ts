// Loads the server-route type augmentation for createFileRoute.
import "@tanstack/react-start";

import { auth } from "@__SLUG__/auth";
import { withClientAddress } from "@__SLUG__/auth/client-address";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";

function handler({ request: inbound }: { readonly request: Request }) {
  const request = withClientAddress(inbound, getRequestIP());
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
