import { describe, expect, it } from "vitest";

import {
  assertBingCdnHttpsUrl,
  buildBingWallpaperUrlFromHpApiPath,
} from "./bingWallpaperUrl";

describe("buildBingWallpaperUrlFromHpApiPath", () => {
  it("joins a relative Bing path", () => {
    expect(buildBingWallpaperUrlFromHpApiPath("/th?id=foo.jpg")).toBe(
      "https://www.bing.com/th?id=foo.jpg",
    );
  });

  it("accepts an absolute https www.bing.com URL", () => {
    expect(
      buildBingWallpaperUrlFromHpApiPath("https://www.bing.com/th?id=x.jpg"),
    ).toBe("https://www.bing.com/th?id=x.jpg");
  });

  it("rejects other hosts", () => {
    expect(
      buildBingWallpaperUrlFromHpApiPath("https://evil.com/th?id=x.jpg"),
    ).toBeNull();
  });

  it("rejects non-path relative values", () => {
    expect(buildBingWallpaperUrlFromHpApiPath("th?id=foo")).toBeNull();
  });

  it("upgrades http to https for www.bing.com", () => {
    expect(
      buildBingWallpaperUrlFromHpApiPath("http://www.bing.com/th?id=x.jpg"),
    ).toBe("https://www.bing.com/th?id=x.jpg");
  });
});

describe("assertBingCdnHttpsUrl", () => {
  it("accepts normalized Bing HTTPS", () => {
    expect(assertBingCdnHttpsUrl("https://www.bing.com/th?id=x.jpg")).toBe(
      "https://www.bing.com/th?id=x.jpg",
    );
  });

  it("rejects after tampered host", () => {
    expect(assertBingCdnHttpsUrl("https://evil.com/x")).toBeNull();
  });
});
