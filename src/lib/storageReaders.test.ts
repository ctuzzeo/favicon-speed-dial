import { describe, expect, test } from "vitest";

import {
  readStorageBoolean,
  readStorageNumber,
  readStorageRecord,
  readStorageString,
  readStorageStringOrFallback,
} from "./storageReaders";

describe("readStorageNumber", () => {
  // Regression: column/row gap of 0 must persist. The old `v || fallback`
  // helper treated a stored 0 as "missing" and reverted it to the default.
  test("returns a stored 0 instead of the fallback", () => {
    expect(readStorageNumber({ "column-gap": 0 }, "column-gap", 28)).toBe(0);
  });
  test("returns a stored non-zero number", () => {
    expect(readStorageNumber({ "row-gap": 12 }, "row-gap", 28)).toBe(12);
  });
  test("falls back when the key is missing", () => {
    expect(readStorageNumber({}, "column-gap", 28)).toBe(28);
  });
  test("falls back on NaN or non-number values", () => {
    expect(readStorageNumber({ k: NaN }, "k", 28)).toBe(28);
    expect(readStorageNumber({ k: "5" }, "k", 28)).toBe(28);
  });
});

describe("readStorageString", () => {
  test("returns a stored string, including empty string", () => {
    expect(readStorageString({ k: "hi" }, "k", "def")).toBe("hi");
    expect(readStorageString({ k: "" }, "k", "def")).toBe("");
  });
  test("falls back on non-string values", () => {
    expect(readStorageString({ k: 5 }, "k", "def")).toBe("def");
  });
});

describe("readStorageStringOrFallback", () => {
  test("treats empty string as missing and uses the fallback", () => {
    expect(readStorageStringOrFallback({ k: "" }, "k", "def")).toBe("def");
    expect(readStorageStringOrFallback({ k: "x" }, "k", "def")).toBe("x");
  });
});

describe("readStorageBoolean", () => {
  test("returns stored booleans, including false", () => {
    expect(readStorageBoolean({ k: false }, "k", true)).toBe(false);
  });
  test("falls back on non-boolean values", () => {
    expect(readStorageBoolean({ k: "true" }, "k", true)).toBe(true);
  });
});

describe("readStorageRecord", () => {
  test("returns a stored plain object", () => {
    const record = { a: "1" };
    expect(readStorageRecord({ k: record }, "k", {})).toBe(record);
  });
  test("falls back on arrays and non-objects", () => {
    const fallback = { a: "1" };
    expect(readStorageRecord({ k: [1, 2] }, "k", fallback)).toBe(fallback);
    expect(readStorageRecord({ k: 5 }, "k", fallback)).toBe(fallback);
  });
});
