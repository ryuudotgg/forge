import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
  interceptors: [
    onError((error, { request }) =>
      reportServerError(error, request.url.pathname),
    ),
  ],
});

async function handler(request: Request) {
  const { matched, response } = await rpcHandler.handle(request, {
    prefix: "/api/orpc",
    context: { headers: request.headers },
  });

  if (matched) return response;

  return new Response("Not Found", { status: 404 });
}

export const GET = handler;
export const POST = handler;
