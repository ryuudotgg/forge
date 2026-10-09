/** @jsxRuntime automatic */
import { Fragment } from "react";
import { Column, Row } from "react-email";
import { Layout } from "../layout";

interface VerificationCodeProps {
  code: string;
  type: string;
  expiresInMinutes: number;
}

export function subject({ type }: VerificationCodeProps) {
  switch (type) {
    case "sign-in":
      return "Your sign in code";

    case "email-verification":
      return "Verify your email";

    case "forget-password":
      return "Your password reset code";

    default:
      return "Your verification code";
  }
}

export default function VerificationCode(props: VerificationCodeProps) {
  const digits = [...props.code];
  const halfway = Math.ceil(digits.length / 2);
  const digitWidth = 48;
  const digitHeight = 64;
  const narrow =
    digits.length > 6
      ? { width: 32, height: 48, spacer: 4, gap: 12 }
      : { width: 40, height: 56, spacer: 6, gap: 16 };

  const cells = digits.map((digit, index) => ({
    digit,
    spacerWidth:
      index === digits.length - 1 ? 0 : index === halfway - 1 ? 24 : 8,
    narrowSpacerWidth:
      index === digits.length - 1
        ? 0
        : index === halfway - 1
          ? narrow.gap
          : narrow.spacer,
  }));

  const rowWidth = cells.reduce(
    (width, cell) => width + digitWidth + cell.spacerWidth,
    0,
  );

  const narrowRowWidth = cells.reduce(
    (width, cell) => width + narrow.width + cell.narrowSpacerWidth,
    0,
  );

  const minutes = `${props.expiresInMinutes} ${props.expiresInMinutes === 1 ? "minute" : "minutes"}`;
  return (
    <Layout
      preview={`${subject(props)}: ${props.code}`}
      heading={subject(props)}
      subtitle="Enter this code to continue."
      footnote={`This code expires in ${minutes}. If you didn't request it, you can ignore this email.`}
    >
      <Row
        align="center"
        className={`max-sm:w-[${narrowRowWidth}px]`}
        style={{ width: rowWidth, tableLayout: "fixed" }}
      >
        {cells.map(({ digit, spacerWidth, narrowSpacerWidth }, index) => (
          <Fragment key={`${index}-${digit}`}>
            <Column
              className={`rounded-md border border-solid border-border bg-card text-center text-xl font-semibold text-foreground dark:border-border-dark dark:bg-card-dark dark:text-foreground-dark max-sm:w-[${narrow.width}px] max-sm:h-[${narrow.height}px]`}
              style={{
                width: digitWidth,
                height: digitHeight,
                boxSizing: "border-box",
                verticalAlign: "middle",
              }}
            >
              {digit}
            </Column>
            {spacerWidth === 0 ? null : (
              <Column
                className={`max-sm:w-[${narrowSpacerWidth}px]`}
                style={{ width: spacerWidth }}
              />
            )}
          </Fragment>
        ))}
      </Row>
    </Layout>
  );
}

VerificationCode.PreviewProps = {
  code: "123456",
  type: "sign-in",
  expiresInMinutes: 5,
} satisfies VerificationCodeProps;
