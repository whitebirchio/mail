import { describe, expect, it } from "vitest";
import { decodeEntities } from "../src/message/entities";
import { decodeWords, displayName, headerValue, parseAddresses } from "../src/message/headers";

describe("decodeWords (RFC 2047)", () => {
  it("decodes B and Q words in any charset, joining adjacent words", () => {
    expect(decodeWords("=?UTF-8?B?Q2Fmw6kgc29vbj8=?=")).toBe("Café soon?");
    expect(decodeWords("=?ISO-8859-1?Q?Caf=E9_au_lait?=")).toBe("Café au lait");
    expect(decodeWords("=?UTF-8?Q?=E6=97=A5?= =?UTF-8?Q?=E6=9C=AC?=")).toBe("日本");
    expect(decodeWords("Re: =?utf-8?b?8J+OiQ==?= party")).toBe("Re: 🎉 party");
    expect(decodeWords("=?windows-1252?Q?=93quoted=94?=")).toBe("“quoted”");
  });

  it("passes plain text through, and falls back to UTF-8 for unknown charsets", () => {
    expect(decodeWords("Plain = text ?= here")).toBe("Plain = text ?= here");
    expect(decodeWords("=?x-unknown?Q?abc?=")).toBe("abc");
  });

  it("finds headers case-insensitively", () => {
    expect(headerValue([{ name: "SUBJECT", value: "=?UTF-8?Q?Hi?=" }], "subject")).toBe("Hi");
    expect(headerValue([], "Subject")).toBe("");
  });
});

describe("parseAddresses", () => {
  it("handles names, quotes with commas, bare addresses, comments and groups", () => {
    expect(parseAddresses('"Example, Ann" <ann@example.org>, bob@example.org, Cy <cy@example.org>')).toEqual([
      { name: "Example, Ann", email: "ann@example.org" },
      { name: "", email: "bob@example.org" },
      { name: "Cy", email: "cy@example.org" },
    ]);
    expect(parseAddresses("dee@example.org (Dee Example)")).toEqual([{ name: "Dee Example", email: "dee@example.org" }]);
    expect(parseAddresses("Team: ann@example.org, bob@example.org;")).toEqual([
      { name: "", email: "ann@example.org" },
      { name: "", email: "bob@example.org" },
    ]);
    expect(parseAddresses("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddresses('"Re: a colon" <x@example.org>')).toEqual([{ name: "Re: a colon", email: "x@example.org" }]);
  });

  it("decodes encoded names", () => {
    expect(parseAddresses("=?UTF-8?Q?Ren=C3=A9e?= <renee@example.org>")).toEqual([{ name: "Renée", email: "renee@example.org" }]);
  });

  it("names someone by display name, else the local part", () => {
    expect(displayName({ name: "Ann", email: "ann@example.org" })).toBe("Ann");
    expect(displayName({ name: "", email: "billing@example.org" })).toBe("billing");
  });
});

describe("decodeEntities", () => {
  it("decodes the entities Gmail leaves in snippets", () => {
    expect(decodeEntities("It&#39;s &quot;done&quot; &amp; &lt;ok&gt; &#x1F389;")).toBe('It\'s "done" & <ok> 🎉');
    expect(decodeEntities("&bogus; &#0;")).toBe("&bogus; &#0;");
  });
});
