import { APP_NAME } from "@mail/core";
import { describe, expect, it } from "vitest";

describe("mail-web", () => {
  it("resolves the core workspace", () => {
    expect(APP_NAME).toBe("Mail");
  });
});
