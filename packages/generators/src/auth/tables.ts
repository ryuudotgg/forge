export interface AuthModelIdentity {
	readonly table: string;
	readonly prisma: string;
}

interface AuthColumnBase {
	readonly name: string;
	readonly sqlName?: string;
	readonly presence: "required" | "nullable";
}

export type AuthModel = keyof typeof authModels;

export type AuthColumn = AuthColumnBase &
	(
		| { readonly type: "text"; readonly index?: "lookup" | "unique" }
		| { readonly type: "integer" | "boolean" | "date" }
		| {
				readonly type: "reference";
				readonly target: AuthModel;
				readonly relation: string;
				readonly inverse: string;
				readonly onDelete: "cascade";
		  }
	);

export interface AuthTable {
	readonly model: AuthModel;
	readonly columns: ReadonlyArray<AuthColumn>;
}

export const authModels = {
	user: { table: "users", prisma: "User" },
	passkey: { table: "passkeys", prisma: "Passkey" },
} satisfies Record<string, AuthModelIdentity>;

export const passkeyTable: AuthTable = {
	model: "passkey",
	columns: [
		{ name: "name", type: "text", presence: "nullable" },
		{ name: "publicKey", type: "text", presence: "required" },
		{
			name: "userId",
			type: "reference",
			target: "user",
			relation: "user",
			inverse: "passkeys",
			onDelete: "cascade",
			presence: "required",
		},
		{
			name: "credentialID",
			sqlName: "credential_id",
			type: "text",
			presence: "required",
			index: "lookup",
		},
		{ name: "counter", type: "integer", presence: "required" },
		{ name: "deviceType", type: "text", presence: "required" },
		{ name: "backedUp", type: "boolean", presence: "required" },
		{ name: "transports", type: "text", presence: "nullable" },
		{ name: "createdAt", type: "date", presence: "nullable" },
		{ name: "aaguid", type: "text", presence: "nullable" },
	],
};

export function authColumnName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}
