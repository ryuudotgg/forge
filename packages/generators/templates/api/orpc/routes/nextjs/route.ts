__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
import { RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
});

async function handler(request: Request) {
  const { matched, response } = await rpcHandler.handle(request, {
    prefix: "/api/orpc",
    context: await createORPCContext({ __AUTH_ARG__, headers: request.headers }),
  });

  if (matched) return response;

  return new Response("Not Found", { status: 404 });
}

export const GET = handler;
export const POST = handler;
