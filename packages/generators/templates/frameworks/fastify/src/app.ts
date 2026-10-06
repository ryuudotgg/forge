import cors from "@fastify/cors";
import Fastify from "fastify";
import { webOrigins } from "../env.js";
// __AUTH_IMPORT__
// __TRPC_IMPORT__

export const app = Fastify();

app.register(cors, {
  allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
  credentials: true,
  exposedHeaders: ["Content-Length"],
  maxAge: 600,
  methods: ["GET", "POST", "OPTIONS"],
  origin: webOrigins,
});

app.get("/", () => ({ ok: true }));

// __TRPC_ROUTE__
// __AUTH_ROUTE__
