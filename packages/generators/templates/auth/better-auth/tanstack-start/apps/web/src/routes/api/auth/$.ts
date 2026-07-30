// Loads the server-route type augmentation for createFileRoute.
import "@tanstack/react-start";

import { auth } from "@__SLUG__/auth";
import { createFileRoute } from "@tanstack/react-router";

function handler({ request }: { readonly request: Request }) {
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
