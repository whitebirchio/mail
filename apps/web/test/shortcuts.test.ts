import { describe, expect, it } from "vitest";
import { KEYS, keyOf } from "@/components/shortcuts";

const ev = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("keyOf", () => {
  it("passes single keys and Enter, keeping case (Shift+I is I)", () => {
    expect(["e", "#", "!", "I", "U", "/", "?", "Enter"].map((k) => keyOf(ev(k)))).toEqual(["e", "#", "!", "I", "U", "/", "?", "Enter"]);
  });

  it("ignores browser and OS chords and named keys", () => {
    expect(keyOf(ev("r", { metaKey: true }))).toBeNull();
    expect(keyOf(ev("c", { ctrlKey: true }))).toBeNull();
    expect(keyOf(ev("e", { altKey: true }))).toBeNull();
    expect(keyOf(ev("ArrowDown"))).toBeNull();
    expect(keyOf(ev("Shift"))).toBeNull();
  });

  it("documents every key it handles", () => {
    expect(KEYS.map(([k]) => k).join(" ")).toMatch(/j \/ k.*e.*#.*!.*s.*Shift \+ I \/ U.*r \/ a \/ f.*c.*\/.*u.*\?/);
  });
});
