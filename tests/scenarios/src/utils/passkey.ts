import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";
import { expect } from "vitest";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value))
		throw new Error("Invalid Passkey Response: expected an object");

	return value;
}

function stringField(value: Record<string, unknown>, name: string): string {
	const field = value[name];
	if (typeof field !== "string" || field.length === 0)
		throw new Error(`Invalid Passkey Response: ${name}`);

	return field;
}

function sha256(value: string | Buffer): Buffer {
	return createHash("sha256").update(value).digest();
}

function authenticatorData(
	rpID: string,
	flags: number,
	counter: number,
): Buffer {
	const count = Buffer.alloc(4);
	count.writeUInt32BE(counter);
	return Buffer.concat([sha256(rpID), Buffer.from([flags]), count]);
}

function responseCookies(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

async function responseJson(
	response: Response,
	output: () => string,
): Promise<unknown> {
	const text = await response.text();
	expect(response.status, `${text}\n${output()}`).toBe(200);

	const value: unknown = JSON.parse(text);
	return value;
}

export async function expectPasskeyCeremony(
	serverOrigin: string,
	origin: string,
	sessionCookie: string,
	output: () => string,
) {
	const request = (path: string, cookie: string, body?: unknown) =>
		fetch(`${serverOrigin}/api/auth/${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				Origin: origin,
				Cookie: cookie,
				"Content-Type": "application/json",
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});

	const listPasskey = async (cookie: string) => {
		const body = await responseJson(
			await request("passkey/list-user-passkeys", cookie),
			output,
		);

		if (!Array.isArray(body))
			throw new Error("Invalid Passkey List: expected an array");

		const entries: ReadonlyArray<unknown> = body;
		expect(entries).toHaveLength(1);

		return record(entries[0]);
	};

	const initialSession = record(
		await responseJson(await request("get-session", sessionCookie), output),
	);

	const userId = stringField(record(initialSession.user), "id");
	const registrationResponse = await request(
		"passkey/generate-register-options",
		sessionCookie,
	);

	const registration = record(await responseJson(registrationResponse, output));
	const rpID = stringField(record(registration.rp), "id");
	const userHandle = stringField(record(registration.user), "id");
	const registrationCookie = `${sessionCookie}; ${responseCookies(registrationResponse)}`;
	expect(rpID).toBe(new URL(origin).hostname);

	const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const jwk = keys.publicKey.export({ format: "jwk" });
	if (jwk.x === undefined || jwk.y === undefined)
		throw new Error("Missing Authenticator Coordinates: ES256 public key");

	const publicKey = Buffer.concat([
		Buffer.from("a5010203262001215820", "hex"),
		Buffer.from(jwk.x, "base64url"),
		Buffer.from("225820", "hex"),
		Buffer.from(jwk.y, "base64url"),
	]);

	const credential = randomBytes(32);
	const credentialID = credential.toString("base64url");
	const registrationData = Buffer.concat([
		authenticatorData(rpID, 0x45, 0),
		Buffer.alloc(16),
		Buffer.from([0, 32]),
		credential,
		publicKey,
	]);

	const attestation = Buffer.concat([
		Buffer.from(
			"a363666d74646e6f6e656761747453746d74a068617574684461746158a4",
			"hex",
		),
		registrationData,
	]);

	const registrationClientData = Buffer.from(
		JSON.stringify({
			type: "webauthn.create",
			challenge: stringField(registration, "challenge"),
			origin,
			crossOrigin: false,
		}),
	);

	const registered = record(
		await responseJson(
			await request("passkey/verify-registration", registrationCookie, {
				name: "Forge software authenticator",
				response: {
					id: credentialID,
					rawId: credentialID,
					type: "public-key",
					authenticatorAttachment: "platform",
					clientExtensionResults: {},
					response: {
						clientDataJSON: registrationClientData.toString("base64url"),
						attestationObject: attestation.toString("base64url"),
						transports: ["internal"],
					},
				},
			}),
			output,
		),
	);

	expect(registered).toMatchObject({ credentialID, userId, counter: 0 });

	const persisted = await listPasskey(sessionCookie);
	expect(persisted).toMatchObject({
		id: stringField(registered, "id"),
		name: "Forge software authenticator",
		credentialID,
		userId,
		counter: 0,
		deviceType: "singleDevice",
		backedUp: false,
		transports: "internal",
		aaguid: "00000000-0000-0000-0000-000000000000",
	});

	expect(Buffer.from(stringField(persisted, "publicKey"), "base64")).toEqual(
		publicKey,
	);

	expect(Number.isNaN(Date.parse(stringField(persisted, "createdAt")))).toBe(
		false,
	);

	const authenticationResponse = await request(
		"passkey/generate-authenticate-options",
		"",
	);

	const authentication = record(
		await responseJson(authenticationResponse, output),
	);

	const authenticationCookie = responseCookies(authenticationResponse);
	expect(stringField(authentication, "rpId")).toBe(rpID);

	const authenticationData = authenticatorData(rpID, 0x05, 1);
	const authenticationClientData = Buffer.from(
		JSON.stringify({
			type: "webauthn.get",
			challenge: stringField(authentication, "challenge"),
			origin,
			crossOrigin: false,
		}),
	);

	const signature = sign(
		"sha256",
		Buffer.concat([authenticationData, sha256(authenticationClientData)]),
		keys.privateKey,
	);

	const assertion = {
		response: {
			id: credentialID,
			rawId: credentialID,
			type: "public-key",
			authenticatorAttachment: "platform",
			clientExtensionResults: {},
			response: {
				clientDataJSON: authenticationClientData.toString("base64url"),
				authenticatorData: authenticationData.toString("base64url"),
				signature: signature.toString("base64url"),
				userHandle,
			},
		},
	};

	const signInResponse = await request(
		"passkey/verify-authentication",
		authenticationCookie,
		assertion,
	);

	const signIn = record(await responseJson(signInResponse, output));
	const signedInCookie = responseCookies(signInResponse);
	expect(record(signIn.user)).toMatchObject({ id: userId });
	expect(signedInCookie).toContain("session_token=");

	const signedInSession = record(
		await responseJson(await request("get-session", signedInCookie), output),
	);

	expect(record(signedInSession.user)).toMatchObject({ id: userId });
	expect(stringField(record(signedInSession.session), "id")).toBe(
		stringField(record(signIn.session), "id"),
	);

	expect(await listPasskey(signedInCookie)).toMatchObject({
		credentialID,
		counter: 1,
	});

	const replay = await request(
		"passkey/verify-authentication",
		authenticationCookie,
		assertion,
	);

	const replayBody: unknown = await replay.json();
	expect(replay.status, `${JSON.stringify(replayBody)}\n${output()}`).toBe(400);
	expect(replayBody).toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
	expect(await listPasskey(signedInCookie)).toMatchObject({
		credentialID,
		counter: 1,
	});
}
