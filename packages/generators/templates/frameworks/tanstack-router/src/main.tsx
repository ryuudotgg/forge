import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { getRouter } from "./router";

const rootElement = document.getElementById("app");
if (rootElement === null) throw new Error("Missing app root element");

ReactDOM.createRoot(rootElement).render(
  <RouterProvider router={getRouter()} />,
);
