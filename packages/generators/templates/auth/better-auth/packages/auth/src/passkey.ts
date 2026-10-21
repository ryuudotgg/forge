import { type PasskeyOptions, passkey } from "@better-auth/passkey";
import { __AUTH_ENV_NAMES__ } from "../env";

const relyingParty = new URL(__PASSKEY_ORIGIN__);

const options = {
  rpID: __PASSKEY_RP_ID__,
  rpName: __APP_NAME__,
  origin: __PASSKEY_ALLOWED_ORIGINS__,
  registration: { extensions: {} },
  authentication: { extensions: {} },
} satisfies PasskeyOptions;

export function passkeyPlugin() {
  return passkey(options);
}
