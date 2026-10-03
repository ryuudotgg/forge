import { expect } from "vitest";

async function expectEmailSession(
	response: Response,
	serverOrigin: string,
	origin: string,
	email: string,
	output: () => string,
) {
	const body = await response.text();
	expect(response.status, `${body}\n${output()}`).toBe(200);

	const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
	if (cookie === undefined)
		throw new Error("Missing Session Cookie: Better Auth email sign-in");

	const session = await fetch(`${serverOrigin}/api/auth/get-session`, {
		headers: { Cookie: cookie, Origin: origin },
	});

	expect(session.status, output()).toBe(200);
	expect(await session.json()).toMatchObject({ user: { email } });
}

export async function expectEmailAuth(
	serverOrigin: string,
	origin: string,
	output: () => string,
) {
	const headers = { "Content-Type": "application/json", Origin: origin };
	const otpEmail = "otp-smoke@example.com";
	const request = await fetch(
		`${serverOrigin}/api/auth/email-otp/send-verification-otp`,
		{
			body: JSON.stringify({ email: otpEmail, type: "sign-in" }),
			headers,
			method: "POST",
		},
	);

	expect(request.status, `${await request.text()}\n${output()}`).toBe(200);

	let otp: string | undefined;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const emailLog = output().split(`Email to ${otpEmail}:`)[1];
		otp = emailLog?.match(/\b\d{6}\b/)?.[0];
		if (otp !== undefined) break;

		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}

	if (otp === undefined) throw new Error(`Missing Email OTP: ${output()}`);

	const signIn = await fetch(`${serverOrigin}/api/auth/sign-in/email-otp`, {
		body: JSON.stringify({ email: otpEmail, otp }),
		headers,
		method: "POST",
	});

	await expectEmailSession(signIn, serverOrigin, origin, otpEmail, output);

	const magicEmail = "magic-smoke@example.com";
	const magicRequest = await fetch(
		`${serverOrigin}/api/auth/sign-in/magic-link`,
		{
			body: JSON.stringify({ email: magicEmail, callbackURL: origin }),
			headers,
			method: "POST",
		},
	);

	expect(magicRequest.status, `${await magicRequest.text()}\n${output()}`).toBe(
		200,
	);

	let magicUrl: string | undefined;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const emailLog = output().split(`Email to ${magicEmail}:`)[1];
		magicUrl = emailLog?.match(
			/https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/,
		)?.[0];

		if (magicUrl !== undefined) break;

		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}

	if (magicUrl === undefined)
		throw new Error(`Missing Magic Link: ${output()}`);

	const verify = await fetch(magicUrl, {
		headers: { Origin: origin },
		redirect: "manual",
	});

	expect(verify.status, output()).toBe(302);
	expect(verify.headers.get("location")).toBe(new URL(origin).href);

	const cookie = verify.headers.get("set-cookie")?.split(";", 1)[0];
	if (cookie === undefined)
		throw new Error("Missing Session Cookie: Better Auth magic link");

	const session = await fetch(`${serverOrigin}/api/auth/get-session`, {
		headers: { Cookie: cookie, Origin: origin },
	});

	expect(session.status, output()).toBe(200);
	expect(await session.json()).toMatchObject({ user: { email: magicEmail } });
}
