import cors from "cors";
import type { Express } from "express";
import express from "express";
import { webOrigins } from "../env.js";
// __AUTH_IMPORT__
// __TRPC_IMPORT__

export const app: Express = express();

app.use(
  cors({
    allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
    credentials: true,
    exposedHeaders: ["Content-Length"],
    maxAge: 600,
    methods: ["GET", "POST", "OPTIONS"],
    origin: webOrigins,
  }),
);

app.get("/", (_request, response) => {
  response.json({ ok: true });
});

// __AUTH_ROUTE__
// __TRPC_ROUTE__
