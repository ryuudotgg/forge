"use client";

import { authClient } from "@__SLUG__/auth/client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <AcceptInvitation invitationId={id} />;
}
