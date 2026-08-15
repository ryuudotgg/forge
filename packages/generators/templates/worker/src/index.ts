import { serve } from "@hono/node-server";
import { env } from "../env.js";
import { createApp } from "./app.js";
import { run } from "./run.js";

const { app, inFlightCount } = createApp({ run, secret: env.WORKER_SECRET });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Worker is running on http://localhost:${info.port}!`);
});

function shutdown() {
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
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
