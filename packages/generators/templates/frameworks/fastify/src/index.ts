import { env } from "../env.js";
import { app } from "./app.js";

async function start() {
  try {
    await app.listen({ port: env.PORT });
    console.log(`Server is running on http://localhost:${env.PORT}!`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown() {
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void start();
