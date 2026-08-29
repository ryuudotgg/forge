import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { env } from "../../env";

// Inferred type only: an explicit ReturnType annotation would erase
// the expo plugin's client methods (getCookie).
export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_SERVER_URL,
  plugins: [
    expoClient({
      scheme: "__SCHEME__",
      storagePrefix: "__SLUG__",
      storage: SecureStore,
    }),
  ],
});
