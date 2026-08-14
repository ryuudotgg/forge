"use client";

import { createAuthClient } from "better-auth/react";
// __CLIENT_ENV_TYPES__

export const authClient: ReturnType<typeof createAuthClient> =
  createAuthClient(__CLIENT_OPTIONS__);
