import { auth } from "@__SLUG__/auth";
import { runBackgroundTasksWith } from "@__SLUG__/auth/background";
import { toNextJsHandler } from "better-auth/next-js";
import { after } from "next/server";

runBackgroundTasksWith(after);

export const { GET, POST } = toNextJsHandler(auth.handler);
