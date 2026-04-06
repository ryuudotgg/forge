import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { appRouter, createTRPCContext } from "~/trpc";

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		req,
		router: appRouter,
		endpoint: "/api/trpc",
		createContext: () => createTRPCContext({ headers: req.headers }),
		onError({ error, path }) {
			console.error(`>>> tRPC Error on '${path}'`, error);
		},
	});

export { handler as GET, handler as POST };
