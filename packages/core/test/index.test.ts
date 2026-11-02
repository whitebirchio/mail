import { describe, expect, it } from "vitest";
import { APP_NAME } from "../src/index";

describe("@mail/core", () => {
  it("loads", () => {
    expect(APP_NAME).toBe("Mail");
  });
});
