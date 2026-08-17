import { serve } from "@hono/node-server";
import { env } from "../env.js";
import { createApp } from "./app.js";
import { run } from "./run.js";

const { app, inFlightCount } = createApp({ run, secret: env.WORKER_SECRET });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Worker is running on http://localhost:${info.port}!`);
});

const shutdownTimeoutMs = 10_000;

function shutdown() {
  const force = setTimeout(() => process.exit(1), shutdownTimeoutMs);
  force.unref();

  server.close(() => {
    if (inFlightCount() === 0) {
      process.exit(0);
      return;
    }

    const drain = setInterval(() => {
      if (inFlightCount() > 0) return;

      clearInterval(drain);
      process.exit(0);
    }, 100);
  });

  server.closeIdleConnections();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
