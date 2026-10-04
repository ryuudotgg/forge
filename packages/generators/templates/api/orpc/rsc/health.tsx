"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "./client";

export function Health() {
  const { data } = useQuery(orpc.health.queryOptions());
  return <p data-testid="orpc-health">{data?.status}</p>;
}
