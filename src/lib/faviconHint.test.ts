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

  it("expires hints older than the TTL and clears them", () => {
    const key = "fs-favhint:e:https://stale.example/";
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      key,
      JSON.stringify({
        url: "https://tracker.example/pixel.png",
        width: 64,
        savedAt: Date.now() - sevenDaysMs - 1,
      }),
    );
    expect(readFaviconHint("https://stale.example/", true)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("treats hints with no savedAt (pre-fix data) as expired", () => {
    const key = "fs-favhint:e:https://legacy.example/";
    localStorage.setItem(
      key,
      JSON.stringify({ url: "https://tracker.example/pixel.png", width: 64 }),
    );
    expect(readFaviconHint("https://legacy.example/", true)).toBeNull();
  });
});
