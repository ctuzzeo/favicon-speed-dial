import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  FAVICON_MIN_QUALITY_PX,
  getChromeFastHqFaviconUrl,
  getFaviconPickerCandidates,
  getPlaceholderFaviconUrl,
  appleTouchHtmlPicksFromLinkTags,
  inferLargestSizeFromManifestSizes,
  isDiscouragedDdgPngIconUrl,
  manifestIconSortWidth,
  mirrorHostnamesForFavicon,
  pickBestFavicon,
  resolveUrlAfterRedirects,
  type FaviconPick,
} from "./faviconResolve";

describe("pickBestFavicon", () => {
  it("prefers other CDN mirrors over wider DuckDuckGo ICO (placeholder-prone)", () => {
    const a: FaviconPick[] = [
      { url: "g", width: 128, type: "google" },
      { url: "d", width: 200, type: "duckduckgo" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("g");
  });

  it("prefers Chrome native over DuckDuckGo ICO when native meets quality", () => {
    const a: FaviconPick[] = [
      { url: "d", width: 256, type: "duckduckgo" },
      { url: "n", width: 256, type: "native-lg" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("n");
  });

  it("uses DuckDuckGo ICO when it is the only successful CDN mirror", () => {
    const a: FaviconPick[] = [{ url: "d", width: 128, type: "duckduckgo" }];
    expect(pickBestFavicon(a)?.url).toBe("d");
  });

  it("never picks DuckDuckGo when any other candidate exists, even if DDG decodes largest", () => {
    expect(
      pickBestFavicon([
        { url: "d", width: 256, type: "duckduckgo" },
        { url: "g", width: 8, type: "google" },
      ])?.url,
    ).toBe("g");
  });

  it("prefers Icon Horse over Google when it decodes larger", () => {
    const a: FaviconPick[] = [
      { url: "g", width: 128, type: "google" },
      { url: "h", width: 192, type: "iconhorse" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("h");
  });

  it("prefers Google over Icon Horse on decoded width tie", () => {
    expect(
      pickBestFavicon([
        { url: "h", width: 128, type: "iconhorse" },
        { url: "g", width: 128, type: "google" },
      ])?.url,
    ).toBe("g");
  });

  it("prefers CDN over Chromium native when CDN meets minimum quality", () => {
    const a: FaviconPick[] = [
      { url: "n", width: 256, type: "native-lg" },
      { url: "g", width: 128, type: "google" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("g");
  });

  it("falls back to larger native when every CDN is tiny", () => {
    const a: FaviconPick[] = [
      { url: "n", width: 64, type: "native" },
      { url: "g", width: 16, type: "google" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("n");
  });

  it("prefers manifest when clearly larger than CDN core", () => {
    const a: FaviconPick[] = [
      { url: "m", width: 512, type: "manifest" },
      { url: "g", width: 128, type: "google" },
      { url: "n", width: 256, type: "native-lg" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("m");
  });

  it("prefers same-origin rootsvg on width tie over CDN", () => {
    const a: FaviconPick[] = [
      { url: "g", width: 128, type: "google" },
      { url: "s", width: 128, type: "rootsvg" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("s");
  });
  it("prefers rootsvg over wider native when no apple exists", () => {
    const a: FaviconPick[] = [
      { url: "n", width: 256, type: "native-lg" },
      { url: "s", width: 64, type: "rootsvg" },
      { url: "i", width: 128, type: "rootico" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("s");
  });


  it("drops DuckDuckGo ip3 PNG even when decoded large", () => {
    const bad = "https://icons.duckduckgo.com/ip3/example.com.png";
    const a: FaviconPick[] = [
      { url: bad, width: 512, type: "manifest" },
      { url: "g", width: 64, type: "google" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("g");
  });

  it("uses type rank on CDN width tie (gstatic over google)", () => {
    const a: FaviconPick[] = [
      { url: "s2", width: 64, type: "google" },
      { url: "v2", width: 64, type: "gstatic" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("v2");
  });

  it("prefers Google over Unavatar on decoded width tie", () => {
    const a: FaviconPick[] = [
      { url: "u", width: 128, type: "unavatar" },
      { url: "g", width: 128, type: "google" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("g");
  });

  it("prefers larger width among apple-touch candidates", () => {
    const a: FaviconPick[] = [
      { url: "a", width: 60, type: "apple" },
      { url: "b", width: 180, type: "apple" },
    ];
    expect(pickBestFavicon(a)?.url).toBe("b");
  });

  it("prefers apple-touch over manifest, CDN, and native when any touch icon decodes", () => {
    expect(
      pickBestFavicon([
        { url: "m", width: 512, type: "manifest" },
        { url: "a", width: 76, type: "apple" },
        { url: "g", width: 256, type: "google" },
        { url: "n", width: 256, type: "native-lg" },
      ])?.url,
    ).toBe("a");
  });

  it("exports quality threshold", () => {
    expect(FAVICON_MIN_QUALITY_PX).toBe(48);
  });
});

describe("mirrorHostnamesForFavicon", () => {
  it("puts naive registrable domain before subdomain", () => {
    expect(mirrorHostnamesForFavicon("library.playstation.com")).toEqual([
      "playstation.com",
      "library.playstation.com",
    ]);
  });

  it("does not duplicate apex-only hosts", () => {
    expect(mirrorHostnamesForFavicon("playstation.com")).toEqual(["playstation.com"]);
    expect(mirrorHostnamesForFavicon("www.example.com")).toEqual(["example.com"]);
  });

  it("uses three-label registrable for co.uk (not co.uk alone)", () => {
    expect(mirrorHostnamesForFavicon("www.google.co.uk")).toEqual(["google.co.uk"]);
    expect(mirrorHostnamesForFavicon("news.bbc.co.uk")).toEqual([
      "bbc.co.uk",
      "news.bbc.co.uk",
    ]);
  });
});

describe("isDiscouragedDdgPngIconUrl", () => {
  it("flags ip3 PNG on DuckDuckGo icons host", () => {
    expect(
      isDiscouragedDdgPngIconUrl("https://icons.duckduckgo.com/ip3/foo.com.png"),
    ).toBe(true);
  });

  it("does not flag DuckDuckGo ICO", () => {
    expect(
      isDiscouragedDdgPngIconUrl("https://icons.duckduckgo.com/ip3/foo.com.ico"),
    ).toBe(false);
  });

  it("does not flag unrelated PNG URLs", () => {
    expect(isDiscouragedDdgPngIconUrl("https://example.com/icon.png")).toBe(false);
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

describe("resolveUrlAfterRedirects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes parallel fetches for the same bookmark URL", async () => {
    const fn = vi.fn(async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        url: "https://dedupe.example/final",
        body: null,
      } as Response;
    });
    vi.stubGlobal("fetch", fn);

    const url = "https://dedupe.example/start";
    const [a, b] = await Promise.all([
      resolveUrlAfterRedirects(url, () => true),
      resolveUrlAfterRedirects(url, () => true),
    ]);
    expect(a).toBe("https://dedupe.example/final");
    expect(b).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("falls back to GET when HEAD throws", async () => {
    let n = 0;
    const fn = vi.fn(async (): Promise<Response> => {
      n += 1;
      if (n === 1) throw new Error("head failed");
      return {
        ok: true,
        status: 200,
        url: "https://fallback.example/after-get",
        body: null,
      } as Response;
    });
    vi.stubGlobal("fetch", fn);

    const out = await resolveUrlAfterRedirects("https://fallback.example/x", () => true);
    expect(out).toBe("https://fallback.example/after-get");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("appleTouchHtmlPicksFromLinkTags", () => {
  it("extracts apple-touch-icon hrefs for probing", () => {
    const html =
      '<head><link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example/a.png"></head>';
    expect(appleTouchHtmlPicksFromLinkTags(html, "https://www.example.com/page")).toEqual(
      [{ url: "https://cdn.example/a.png", width: 0, type: "apple" }],
    );
  });

  it("maps precomposed rel to apple-pre", () => {
    const html =
      '<link rel="apple-touch-icon-precomposed" href="/touch.png">';
    expect(appleTouchHtmlPicksFromLinkTags(html, "https://z.example/")).toEqual([
      { url: "https://z.example/touch.png", width: 0, type: "apple-pre" },
    ]);
  });

  it("ignores generic rel=icon", () => {
    const html =
      '<link rel="icon" href="/f.ico"><link rel="apple-touch-icon" href="/a.png">';
    expect(appleTouchHtmlPicksFromLinkTags(html, "https://z.example/")).toEqual([
      { url: "https://z.example/a.png", width: 0, type: "apple" },
    ]);
  });
});

describe("getFaviconPickerCandidates", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : String(input);
        return {
          ok: true,
          status: 200,
          url: u,
          body: null,
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty for invalid URL", async () => {
    expect(await getFaviconPickerCandidates("not-a-url")).toEqual([]);
  });

  it("includes mirror URLs aligned with automatic resolution", async () => {
    const url = "https://www.example.com/path?q=1";
    const list = await getFaviconPickerCandidates(url);
    const urls = list.map((x) => x.url);
    expect(urls.some((u) => u.includes("t2.gstatic.com/faviconV2"))).toBe(true);
    expect(
      urls.some((u) => u.includes("google.com/s2/favicons") && u.includes("sz=256")),
    ).toBe(true);
    expect(urls.some((u) => u.includes("icon.horse") && u.includes("size=big"))).toBe(
      true,
    );
    expect(urls.some((u) => u.includes("unavatar.io/domain/"))).toBe(true);
    expect(urls.some((u) => u.endsWith(".ico") && u.includes("duckduckgo"))).toBe(
      true,
    );
    expect(urls.some((u) => u.endsWith(".png") && u.includes("duckduckgo"))).toBe(
      false,
    );
    expect(urls.some((u) => u.includes("logo.clearbit.com"))).toBe(false);
    expect(urls.some((u) => u.includes("favicon.yandex.net"))).toBe(false);
    expect(urls.some((u) => u.includes("apple-touch-icon.png"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/favicon.svg"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/icon.svg"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/favicon.ico"))).toBe(true);
    expect(urls.some((u) => u.includes("apple-touch-icon-180x180.png"))).toBe(true);
    expect(urls.some((u) => u.includes("apple-touch-icon-167x167.png"))).toBe(false);
    expect(urls.some((u) => u.includes("apple-touch-icon-120x120.png"))).toBe(false);
    expect(urls.some((u) => u.includes("apple-touch-icon-76x76.png"))).toBe(false);
  });

  it("omits third-party mirrors when externalFaviconProviders is false", async () => {
    const url = "https://www.example.com/path";
    const list = await getFaviconPickerCandidates(url, {
      externalFaviconProviders: false,
    });
    const urls = list.map((x) => x.url);
    expect(urls.some((u) => u.includes("t2.gstatic.com"))).toBe(false);
    expect(urls.some((u) => u.includes("google.com/s2/favicons"))).toBe(false);
    expect(urls.some((u) => u.includes("icon.horse"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/favicon.svg"))).toBe(true);
  });

  it("includes registrable apex mirrors for subdomains (PlayStation-style)", async () => {
    const list = await getFaviconPickerCandidates(
      "https://library.playstation.com/wishlist",
    );
    const urls = list.map((x) => x.url);
    expect(urls.some((u) => u.includes("domain=playstation.com"))).toBe(true);
    expect(urls.some((u) => u.includes("library.playstation.com"))).toBe(true);
    expect(list.some((o) => o.name.includes("playstation.com"))).toBe(true);
  });

  it("uses post-redirect origin for same-origin and mirror URLs", async () => {
    (globalThis.fetch as Mock).mockImplementation(
      async (input: RequestInfo | URL) => {
        const u =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : String(input);
        if (u.includes("openreach.co.uk")) {
          return {
            ok: true,
            status: 200,
            url: "https://www.openreach.com/welcome",
            body: null,
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          url: u,
          body: null,
        } as Response;
      },
    );

    const list = await getFaviconPickerCandidates(
      "https://www.ournetwork.openreach.co.uk/some-page",
    );
    const urls = list.map((o) => o.url);
    expect(urls.some((u) => u.startsWith("https://www.openreach.com/"))).toBe(true);
    expect(urls.some((u) => u.includes("logo.clearbit.com"))).toBe(false);
    expect(urls.some((u) => u.includes("favicon.yandex.net"))).toBe(false);
    expect(
      urls.some(
        (u) =>
          u.includes("ournetwork.openreach.co.uk") ||
          u.includes("icon.horse/icon/openreach.com"),
      ),
    ).toBe(true);
  });
});

describe("getChromeFastHqFaviconUrl", () => {
  it("returns null when not a Chrome build", () => {
    expect(getChromeFastHqFaviconUrl("https://www.example.com/")).toBeNull();
  });
});

describe("getPlaceholderFaviconUrl", () => {
  it("returns null for invalid URL", () => {
    expect(getPlaceholderFaviconUrl("not-a-url")).toBeNull();
  });

  it("uses small Google S2 when not in Chrome build", () => {
    const u = getPlaceholderFaviconUrl("https://www.example.com/a");
    expect(u).toContain("google.com/s2/favicons");
    expect(u).toContain("sz=32");
    expect(u).toContain("example.com");
  });

  it("returns null for non-Chrome when external providers disabled", () => {
    expect(
      getPlaceholderFaviconUrl("https://www.example.com/a", false),
    ).toBeNull();
  });
});

describe("manifestIconSortWidth", () => {
  it("treats .svg as high-res for sorting", () => {
    expect(manifestIconSortWidth({ src: "/icon.svg" })).toBe(512);
    expect(manifestIconSortWidth({ src: "/icon.svg", sizes: "192x192" })).toBe(512);
    expect(manifestIconSortWidth({ src: "/icon.png", sizes: "192x192" })).toBe(192);
  });

  it("detects svg from manifest type", () => {
    expect(manifestIconSortWidth({ src: "/assets/app-icon", type: "image/svg+xml" })).toBe(
      512,
    );
  });
});
