import { auth } from "@__SLUG__/auth";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";

export function registerAuthRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const response = await auth.handler(
        new Request(
          new URL(request.url, `http://${request.headers.host ?? "localhost"}`),
          {
            body:
              request.body === undefined
                ? undefined
                : JSON.stringify(request.body),
            headers: fromNodeHeaders(request.headers),
            method: request.method,
          },
        ),
      );

      for (const [name, value] of response.headers) reply.header(name, value);
      return reply.status(response.status).send(await response.text());
    },
  });
}
