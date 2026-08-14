import { Hono } from "hono";
// __AUTH_IMPORT__
// __TRPC_IMPORT__

export const app = new Hono();

app.get("/", (c) => c.json({ ok: true }));

// __TRPC_ROUTE__
// __AUTH_ROUTE__
