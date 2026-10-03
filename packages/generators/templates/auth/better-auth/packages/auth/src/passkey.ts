import { type PasskeyOptions, passkey } from "@better-auth/passkey";
import { env } from "../env";

const relyingParty = new URL(__PASSKEY_ORIGIN__);

const options = {
  rpID: relyingParty.hostname,
  rpName: __PASSKEY_NAME__,
  origin: relyingParty.origin,
  registration: { extensions: {} },
  authentication: { extensions: {} },
} satisfies PasskeyOptions;

export function passkeyPlugin() {
  return passkey(options);
}
