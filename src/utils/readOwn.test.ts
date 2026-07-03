import { describe, expect, it } from "vitest";

import { readOwn } from "./readOwn";

describe("readOwn", () => {
  it("returns an own property's value", () => {
    expect(readOwn({ "example.com": "https://cdn/x.png" }, "example.com")).toBe(
      "https://cdn/x.png",
    );
  });

  it("returns undefined for an absent key", () => {
    expect(readOwn({ "example.com": "x" }, "other.com")).toBeUndefined();
  });

  it("does not read inherited Object.prototype members", () => {
    // A bookmark hostname like "constructor" / "__proto__" / "hasOwnProperty" must not
    // resolve to the inherited prototype value.
    const record: Record<string, string> = {};
    expect(readOwn(record, "constructor")).toBeUndefined();
    expect(readOwn(record, "__proto__")).toBeUndefined();
    expect(readOwn(record, "hasOwnProperty")).toBeUndefined();
    expect(readOwn(record, "toString")).toBeUndefined();
  });

  it("still returns an own value that shadows a prototype name", () => {
    expect(readOwn({ constructor: "https://cdn/c.png" }, "constructor")).toBe(
      "https://cdn/c.png",
    );
  });

  it("returns undefined for an undefined record or empty key", () => {
    expect(readOwn(undefined, "example.com")).toBeUndefined();
    expect(readOwn({ "": "x" } as Record<string, string>, "")).toBe("x");
  });
});
