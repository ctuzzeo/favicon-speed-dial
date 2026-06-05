import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFaviconHint, writeFaviconHint } from "./faviconHint";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("faviconHint", () => {
  it("round-trips a hint", () => {
    writeFaviconHint("https://x.com/", true, {
      url: "https://cdn/x.png",
      width: 64,
    });
    expect(readFaviconHint("https://x.com/", true)).toEqual({
      url: "https://cdn/x.png",
      width: 64,
    });
  });

  it("keys separately by the external flag", () => {
    writeFaviconHint("https://x.com/", true, { url: "https://e.png", width: 64 });
    expect(readFaviconHint("https://x.com/", false)).toBeNull();
    expect(readFaviconHint("https://x.com/", true)?.url).toBe("https://e.png");
  });

  it("returns null for missing or malformed entries", () => {
    expect(readFaviconHint("https://missing/", true)).toBeNull();
    localStorage.setItem("fs-favhint:e:https://bad/", "not json");
    expect(readFaviconHint("https://bad/", true)).toBeNull();
    localStorage.setItem("fs-favhint:e:https://partial/", JSON.stringify({ url: "x" }));
    expect(readFaviconHint("https://partial/", true)).toBeNull();
  });
});
