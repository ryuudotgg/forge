import { auth } from "@__SLUG__/auth";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  return auth.handler(request);
}

export function action({ request }: ActionFunctionArgs) {
  return auth.handler(request);
}
