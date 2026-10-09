import { beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailMessage, sendEmail } from "./index";

const sent = vi.hoisted((): Array<{ html: string; text: string }> => []);

__MOCK__

vi.mock("../env", () => ({
  env: {
    NODE_ENV: "test",
    EMAIL_FROM: "sender@example.com",
    __KEY__: "test-key",
  },
}));

const cases: ReadonlyArray<{ message: EmailMessage; expected: string }> = [
__CASES__
];

beforeEach(() => {
  sent.length = 0;
});

describe("sendEmail", () => {
  it.each(cases)(
    "sends $message.template as html and text",
    async ({ message, expected }) => {
      await sendEmail(message);

      expect(sent).toHaveLength(1);

      const [email] = sent;

      expect(email?.html).toMatch(/style="[^"]+"/);
      expect(email?.text).toContain(expected);
    },
  );
});
