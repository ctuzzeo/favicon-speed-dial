import { describe, expect, it } from "vitest";

import {
  collectPerSiteEntries,
  MANUAL_FAVICON_INFIX,
  mergeLegacyAndPerSite,
  parsePerSiteKey,
  perSiteKey,
  SITE_IMAGE_INFIX,
} from "./syncKeys";

describe("perSiteKey / parsePerSiteKey", () => {
  it("round-trips a hostname", () => {
    const k = perSiteKey("2.0", MANUAL_FAVICON_INFIX, "youtube.com");
    expect(k).toBe("2.0-manual-favicon:youtube.com");
    expect(parsePerSiteKey("2.0", MANUAL_FAVICON_INFIX, k)).toBe("youtube.com");
  });

  it("does not match the legacy blob key or other settings", () => {
    expect(
      parsePerSiteKey("2.0", MANUAL_FAVICON_INFIX, "2.0-manual-favicons"),
    ).toBeNull();
    expect(
      parsePerSiteKey("2.0", MANUAL_FAVICON_INFIX, "2.0-dial-colors"),
    ).toBeNull();
  });

  it("keeps the two kinds distinct", () => {
    const favKey = perSiteKey("2.0", MANUAL_FAVICON_INFIX, "x.com");
    expect(parsePerSiteKey("2.0", SITE_IMAGE_INFIX, favKey)).toBeNull();
  });
});

describe("collectPerSiteEntries", () => {
  it("collects only matching string entries", () => {
    const snap = {
      "2.0-manual-favicon:a.com": "https://a/i.png",
      "2.0-manual-favicon:b.com": "https://b/i.png",
      "2.0-manual-favicons": { "old.com": "x" },
      "2.0-site-image:c.com": "data:image/webp;base64,AAA",
      "last-version": "3.0.7",
    };
    expect(collectPerSiteEntries(snap, "2.0", MANUAL_FAVICON_INFIX)).toEqual({
      "a.com": "https://a/i.png",
      "b.com": "https://b/i.png",
    });
    expect(collectPerSiteEntries(snap, "2.0", SITE_IMAGE_INFIX)).toEqual({
      "c.com": "data:image/webp;base64,AAA",
    });
  });
});

describe("mergeLegacyAndPerSite", () => {
  it("prefers per-site over legacy on conflict", () => {
    expect(
      mergeLegacyAndPerSite(
        { "a.com": "old", "b.com": "keep" },
        { "a.com": "new" },
      ),
    ).toEqual({ "a.com": "new", "b.com": "keep" });
  });
});
