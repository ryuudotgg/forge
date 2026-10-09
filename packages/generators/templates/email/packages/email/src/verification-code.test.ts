import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { describe, expect, it } from "vitest";
import VerificationCode, { subject } from "./templates/verification-code";

describe("verification code", () => {
  it.each([
    { code: "1234", expiresInMinutes: 1 },
    { code: "123456", expiresInMinutes: 5 },
    { code: "12345678", expiresInMinutes: 10 },
  ])(
    "renders $code with its configured expiry",
    async ({ code, expiresInMinutes }) => {
      const props = { code, type: "sign-in", expiresInMinutes };
      const html = await render(createElement(VerificationCode, props));

      const cells = [...html.matchAll(/<td\b([^>]*)>([^<]*)<\/td>/g)];
      const boxes = cells.filter((cell) => /^\d$/.test(cell[2] ?? ""));
      const spacers = cells.filter((cell) => cell[2] === "");
      const halfway = Math.ceil(code.length / 2);
      const minutes = `${expiresInMinutes} ${expiresInMinutes === 1 ? "minute" : "minutes"}`;

      expect(boxes).toHaveLength(code.length);

      for (const box of boxes) {
        expect(box[1]).toContain("width:48px");
        expect(box[1]).toContain("height:64px");

        expect(box[1]).toMatch(/border(?:-width)?:1px/);
        expect(box[1]).toMatch(/border(?:-style)?:[^";]*solid/);
        expect(box[1]).toContain("border-radius:8px");
        expect(box[1]).toContain("background-color:");
      }

      expect(spacers).toHaveLength(code.length - 1);

      for (const [index, spacer] of spacers.entries())
        expect(spacer[1]).toContain(
          `width:${index === halfway - 1 ? 24 : 8}px`,
        );

      expect(cells.map((cell) => cell[2]).join("")).toBe(code);
      expect(html).toContain(
        `width:${code.length * 48 + (code.length - 2) * 8 + 24}px`,
      );

      expect(html).toContain(`${subject(props)}: ${code}`);
      expect(toPlainText(html)).toContain(code);
      expect(toPlainText(html)).toContain(`This code expires in ${minutes}.`);
    },
  );
});
