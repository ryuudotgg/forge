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
		| {
				readonly type: "text";
				readonly index?: "lookup" | "unique";
				readonly default?: string;
		  }
		| { readonly type: "integer"; readonly default?: number }
		| { readonly type: "boolean"; readonly default?: boolean }
		| { readonly type: "date"; readonly default?: "now" }
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
	twoFactor: { table: "two_factors", prisma: "TwoFactor" },
	organization: { table: "organizations", prisma: "Organization" },
	member: { table: "members", prisma: "Member" },
	invitation: { table: "invitations", prisma: "Invitation" },
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

export const twoFactorTable: AuthTable = {
	model: "twoFactor",
	columns: [
		{ name: "secret", type: "text", presence: "required", index: "lookup" },
		{ name: "backupCodes", type: "text", presence: "required" },
		{
			name: "userId",
			type: "reference",
			target: "user",
			relation: "user",
			inverse: "twoFactors",
			onDelete: "cascade",
			presence: "required",
		},
		{ name: "verified", type: "boolean", presence: "nullable", default: true },
		{
			name: "failedVerificationCount",
			type: "integer",
			presence: "nullable",
			default: 0,
		},
		{ name: "lockedUntil", type: "date", presence: "nullable" },
	],
};

export const organizationTables: ReadonlyArray<AuthTable> = [
	{
		model: "organization",
		columns: [
			{ name: "name", type: "text", presence: "required" },
			{ name: "slug", type: "text", presence: "required", index: "unique" },
			{ name: "logo", type: "text", presence: "nullable" },
			{ name: "createdAt", type: "date", presence: "required" },
			{ name: "metadata", type: "text", presence: "nullable" },
		],
	},
	{
		model: "member",
		columns: [
			{
				name: "organizationId",
				type: "reference",
				target: "organization",
				relation: "organization",
				inverse: "members",
				onDelete: "cascade",
				presence: "required",
			},
			{
				name: "userId",
				type: "reference",
				target: "user",
				relation: "user",
				inverse: "members",
				onDelete: "cascade",
				presence: "required",
			},
			{ name: "role", type: "text", presence: "required", default: "member" },
			{ name: "createdAt", type: "date", presence: "required" },
		],
	},
	{
		model: "invitation",
		columns: [
			{
				name: "organizationId",
				type: "reference",
				target: "organization",
				relation: "organization",
				inverse: "invitations",
				onDelete: "cascade",
				presence: "required",
			},
			{ name: "email", type: "text", presence: "required", index: "lookup" },
			{ name: "role", type: "text", presence: "nullable" },
			{
				name: "status",
				type: "text",
				presence: "required",
				default: "pending",
			},
			{ name: "expiresAt", type: "date", presence: "required" },
			{ name: "createdAt", type: "date", presence: "required", default: "now" },
			{
				name: "inviterId",
				type: "reference",
				target: "user",
				relation: "inviter",
				inverse: "invitations",
				onDelete: "cascade",
				presence: "required",
			},
		],
	},
];

export function authColumnName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}
