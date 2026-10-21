import type { ForgeConfig } from "../config";
import { standaloneApiOrigin } from "../origins";

export const acceptInvitationSegment = "accept-invitation";

const organizationLimit = 5;
const invitationLimit = 20;

type InvitationLinkBase = "env.WEB_URL" | "env.APP_ORIGIN";

function invitationLinkBase(
	config: ForgeConfig,
): InvitationLinkBase | undefined {
	if (config.web === undefined) return undefined;

	return standaloneApiOrigin(config) === undefined
		? "env.APP_ORIGIN"
		: "env.WEB_URL";
}

function invitationUrl(base: InvitationLinkBase): string {
	return `        const url = new URL(\`/${acceptInvitationSegment}/\${id}\`, ${base});`;
}

function invitationEmail(
	base: InvitationLinkBase | undefined,
): ReadonlyArray<string> {
	return [
		...(base === undefined ? [] : [invitationUrl(base), ""]),
		"        await sendEmail({",
		"          to: email,",
		'          template: "invitation",',
		"          props: {",
		"            email,",
		"            inviterName: inviter.user.name,",
		"            inviterEmail: inviter.user.email,",
		"            organizationName: organization.name,",
		"            invitationId: id,",
		...(base === undefined ? [] : ["            url: url.href,"]),
		"          },",
		"        });",
	];
}

function invitationFallback(
	base: InvitationLinkBase | undefined,
): ReadonlyArray<string> {
	return [
		'        if (env.NODE_ENV !== "development") {',
		"          console.warn(",
		'            "An invitation was created, but no email provider is configured to deliver it.",',
		"          );",
		"          return;",
		"        }",
		"",
		...(base === undefined
			? [
					"        console.info(",
					"          `Invitation ${id} to ${organization.name} for ${email} from ${inviter.user.email}`,",
					"        );",
				]
			: [
					invitationUrl(base),
					"        console.info(",
					"          `Invitation to ${organization.name} for ${email} from ${inviter.user.email}: ${url}`,",
					"        );",
				]),
	];
}

const invitationRefusal = [
	"      organizationHooks: {",
	"        async beforeCreateInvitation() {",
	'          if (env.NODE_ENV === "development") return;',
	"",
	'          throw new APIError("BAD_REQUEST", {',
	"            message:",
	`              "Invitations need an email provider, so this project can't send them yet.",`,
	"          });",
	"        },",
	"      },",
];

export function organizationServerCall(config: ForgeConfig): string {
	const base = invitationLinkBase(config);
	return [
		"organization({",
		`      organizationLimit: ${organizationLimit},`,
		`      invitationLimit: ${invitationLimit},`,
		...(config.emailProvider === undefined ? invitationRefusal : []),
		"      async sendInvitationEmail({ id, email, organization, inviter }) {",
		...(config.emailProvider === undefined
			? invitationFallback(base)
			: invitationEmail(base)),
		"      },",
		"    })",
	].join("\n");
}
