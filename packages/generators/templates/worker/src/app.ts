import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

export interface WorkerDeps {
  readonly run: () => Promise<void>;
  readonly secret: string;
  readonly staleAfterMs?: number;
}

export function createApp(deps: WorkerDeps) {
  const app = new Hono();
  const staleAfterMs = deps.staleAfterMs ?? 5 * 60 * 1000;

  let inFlight = 0;
  let lastFinishedAt = Date.now();

  app.get("/health", (c) => {
    const idleMs = Date.now() - lastFinishedAt;
    const stale = inFlight === 0 && idleMs > staleAfterMs;

    return c.json({ inFlight, idleMs, ok: !stale }, stale ? 503 : 200);
  });

  app.use("/run", bearerAuth({ token: deps.secret }));
  app.post("/run", async (c) => {
    inFlight += 1;
    try {
      await deps.run();
      return c.json({ ok: true });
    } finally {
      inFlight -= 1;
      lastFinishedAt = Date.now();
    }
  });

  return { app, inFlightCount: () => inFlight };
}
