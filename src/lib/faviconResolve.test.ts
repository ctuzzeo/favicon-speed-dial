import { describe, expect, it } from "vitest";

import {
  FAVICON_MIN_QUALITY_PX,
  inferLargestSizeFromManifestSizes,
  pickBestFavicon,
  type FaviconPick,
} from "./faviconResolve";

describe("pickBestFavicon", () => {
  it("prefers larger width", () => {
    const a: FaviconPick[] = [
      { url: "a", width: 16, type: "google" },
      { url: "b", width: 128, type: "native" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("b");
  });

  it("uses type rank on width tie (Google over native at same pixels)", () => {
    const a: FaviconPick[] = [
      { url: "g", width: 64, type: "google" },
      { url: "n", width: 64, type: "native" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("g");
  });

  it("exports quality threshold", () => {
    expect(FAVICON_MIN_QUALITY_PX).toBe(48);
  });
});

describe("inferLargestSizeFromManifestSizes", () => {
  it("returns 0 for empty", () => {
    expect(inferLargestSizeFromManifestSizes()).toBe(0);
    expect(inferLargestSizeFromManifestSizes("")).toBe(0);
  });

  it("picks largest from multiple sizes", () => {
    expect(inferLargestSizeFromManifestSizes("192x192 512x512")).toBe(512);
  });
});
