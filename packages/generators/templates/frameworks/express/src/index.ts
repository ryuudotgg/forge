import { env } from "../env.js";
import { app } from "./app.js";

const server = app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}!`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
