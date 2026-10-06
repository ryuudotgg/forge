import { render, toPlainText } from "@react-email/components";
import { createElement, type ReactElement } from "react";
import { customTemplates } from "./custom";
__IMPORTS__
const modules = __MODULES__;

type TemplateProps = {
  [Name in keyof typeof modules]: Parameters<
    (typeof modules)[Name]["default"]
  >[0];
};

type TemplateName = keyof TemplateProps;

interface Template<Props> {
  default: (props: Props) => ReactElement;
  subject: (props: Props) => string;
}

const templates: { [Name in TemplateName]: Template<TemplateProps[Name]> } =
  modules;

export type EmailMessage<Name extends TemplateName = TemplateName> = {
  [Key in Name]: { to: string; template: Key; props: TemplateProps[Key] };
}[Name];

export async function renderMessage<Name extends TemplateName>(
  message: EmailMessage<Name>,
) {
  const template: Template<TemplateProps[Name]> = templates[message.template];
  const html = await render(createElement(template.default, message.props));
  return {
    to: message.to,
    subject: template.subject(message.props),
    html,
    text: toPlainText(html),
  };
}
