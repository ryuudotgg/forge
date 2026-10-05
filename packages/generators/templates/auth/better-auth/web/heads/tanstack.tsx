import { authClient } from "@__SLUG__/auth/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/accept-invitation/$id")({
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <AcceptInvitation invitationId={id} />;
}
