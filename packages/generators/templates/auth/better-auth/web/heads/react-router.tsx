import { authClient } from "@__SLUG__/auth/client";
import { useEffect, useState } from "react";
import type { Route } from "./+types/accept-invitation";

export default function Page({ params }: Route.ComponentProps) {
  return <AcceptInvitation invitationId={params.id} />;
}
