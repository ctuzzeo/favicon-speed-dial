/**
 * Favicon resolution probes several sources in parallel, then picks by **decoded**
 * bitmap size (naturalWidth / naturalHeight) with small type tie-breaks.
 *
 * **Third-party mirrors** (subject to their terms / availability):
 * - Google S2 (`s2/favicons`) and faviconV2 (`t2.gstatic.com`)
 * - DuckDuckGo ICO (`icons.duckduckgo.com/.../*.ico` — `.png` is omitted; `.ico` is
 *   probed, but the usual **generic grey-circle** decode is dropped via a small
 *   canvas heuristic so ranking can use real DDG hits when they exist.)
 * - [Icon Horse](https://icon.horse/) — `icon.horse/icon/…` (manual picker only; free tier
 *   is 1,000 icons/month so automatic resolution omits it.)
 * - [Unavatar](https://unavatar.io/) — `unavatar.io/domain/{host}` (manual picker only;
 *   omitted from automatic probing to reduce anonymous rate limits.)
 *
 * **Same-origin:** `favicon.svg`, `icon.svg`, `favicon.ico`, common
 * `apple-touch-icon-{180,152}…` paths, plus default apple-touch PNGs. If those miss,
 * a bounded HTML read collects **`<link rel="apple-touch-icon">`** hrefs (often on a
 * CDN). A successful **apple-touch** decode wins over manifest, mirrors, and native.
 *
 * **Redirects (favicon):** resolve redirects once, then probe the saved URL and (when
 * it differs) the final URL in parallel and merge with {@link pickBestFavicon} — e.g.
 * `http://` bookmarks still pick up `https://` same-origin touch icons. Mirror hosts
 * include a naive registrable domain first (`library.playstation.com` →
 * `playstation.com`, then the full host). Multi-part suffixes like `co.uk` use three
 * trailing labels (`google.co.uk`, not `co.uk`).
 *
 * **Optional HTML `<link>` discovery** (settings toggle, manual favicon picker only):
 * fetches the bookmark URL (bounded read) and parses declared `rel=icon` / touch /
 * mask links. Does not run for automatic dial resolution unless scope is expanded later.
 */
import { get, set } from "idb-keyval";

/** Icons below this width get the soft “plate” framing in the dial UI. */
export const FAVICON_MIN_QUALITY_PX = 48;

/**
 * Bump when favicon candidate strategy changes so clients refetch sharper sources.
 * `e` / `i` suffix: external mirrors vs first-party-only cache entries.
 */
const CACHE_PREFIX = "fsd-fav23-";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FaviconCandidateType =
  | "manifest"
  | "rootsvg"
  | "rootico"
  | "native"
  | "native-lg"
  | "apple"
  | "apple-pre"
  | "gstatic"
  | "google"
  | "duckduckgo"
  | "iconhorse"
  | "unavatar"
  | "cache";

export interface FaviconPick {
  url: string;
  width: number;
  type: FaviconCandidateType;
}

interface CacheEntry {
  url: string;
  width: number;
  savedAt: number;
}

const memory = new Map<string, CacheEntry>();

/**
 * One in-flight resolve per **saved bookmark URL** (normalized `href`) so different
 * bookmarks are not collapsed when they share the same post-login host.
 */
const inFlightByBookmarkHref = new Map<string, Promise<FaviconPick | null>>();

/** IDB + memory key for a bookmark’s resolved favicon (full URL, not post-redirect host). */
function bookmarkFaviconStorageKey(
  fullUrl: string,
  externalFaviconProviders: boolean,
): string | null {
  const p = parseBookmarkUrl(fullUrl);
  if (!p || (p.protocol !== "http:" && p.protocol !== "https:")) return null;
  return `${CACHE_PREFIX}${externalFaviconProviders ? "e" : "i"}:${p.href}`;
}

function isFresh(entry: CacheEntry) {
  return Date.now() - entry.savedAt < CACHE_TTL_MS;
}

export function parseBookmarkUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function urlsEquivalentBookmarks(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

function urlsDifferOnlyByScheme(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const hostA = ua.hostname.replace(/^www\./i, "");
    const hostB = ub.hostname.replace(/^www\./i, "");
    const normPath = (u: URL) =>
      u.pathname.length > 1 && u.pathname.endsWith("/")
        ? u.pathname.slice(0, -1)
        : u.pathname;
    return (
      hostA == hostB &&
      normPath(ua) === normPath(ub) &&
      ua.search === ub.search &&
      ua.hash === ub.hash &&
      ua.protocol !== ub.protocol
    );
  } catch {
    return false;
  }
}

/**
 * Two-label public suffixes where the registrable domain is **three** trailing labels
 * (e.g. `google.co.uk`, not `co.uk`). Not a full PSL — extend when real sites misfire.
 */
const MULTI_LABEL_PUBLIC_SUFFIX2 = new Set([
  "ac.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.au",
  "com.br",
  "com.cn",
  "com.co",
  "com.hk",
  "com.mx",
  "com.my",
  "com.sg",
  "com.tr",
  "com.tw",
  "edu.au",
  "gen.in",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "ne.jp",
  "ne.kr",
  "net.au",
  "net.in",
  "net.nz",
  "net.uk",
  "net.za",
  "nhs.uk",
  "or.jp",
  "or.kr",
  "org.au",
  "org.in",
  "org.nz",
  "org.uk",
  "org.za",
  "plc.uk",
  "sch.uk",
  "web.za",
]);

/**
 * Naive registrable-style host: `a.b.example.com` → `example.com`.
 * Handles common `*.co.uk` / `*.com.au` style suffixes (three labels, not two).
 */
function naiveRegistrableHost(hostname: string): string {
  const h = hostname.replace(/^www\./i, "");
  const labels = h.split(".").filter(Boolean).map((l) => l.toLowerCase());
  if (labels.length <= 2) return labels.join(".");

  const last2 = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  if (labels.length >= 3 && MULTI_LABEL_PUBLIC_SUFFIX2.has(last2)) {
    return labels.slice(-3).join(".");
  }
  return last2;
}

/**
 * Hostnames for third-party favicon mirrors: **registrable domain first**, then the
 * full host when they differ (e.g. `playstation.com`, then `library.playstation.com`).
 */
export function mirrorHostnamesForFavicon(hostname: string): string[] {
  const h = hostname.replace(/^www\./i, "");
  const apex = naiveRegistrableHost(hostname);
  if (h.toLowerCase() === apex) return [h];
  return [apex, h];
}

/**
 * DuckDuckGo’s `ip3/…/*.png` endpoint often returns a generic placeholder bitmap.
 * We dropped it from candidates; this guards old caches / manual picks / manifests.
 */
export function isDiscouragedDdgPngIconUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== "icons.duckduckgo.com") return false;
    return /\/ip3\/[^/]+\.png$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * DuckDuckGo `ip3/{host}.ico` often decodes to a **large** generic “grey circle /
 * chevron” placeholder, so width-based ranking wrongly beats real icons (e.g. Chrome
 * `/_favicon/`). We still probe it as a last-resort mirror; this identifies the URL
 * pattern for cache busting and ranking, not pixel-perfect placeholder detection.
 */
function isDuckDuckGoIp3IcoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== "icons.duckduckgo.com") return false;
    return /\/ip3\/[^/]+\.ico$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * SHA-256 (hex) of **known generic** DuckDuckGo `ip3/*.ico` bodies (same bytes served
 * for many “no icon” cases). When the response matches, we skip DDG for auto-pick but
 * still allow real DDG payloads (different digest) to decode and compete.
 * CDN artwork can change — extend this set if a new generic appears.
 */
const KNOWN_DDG_PLACEHOLDER_SHA256 = new Set<string>([
  /* ~1478 B “unknown / globe” asset (e.g. example.com, many SSO hosts) */
  "e5db88ea2322863ca17817b99d60006c625a31cff0dad49cf05d3c6d16a75c17",
  /* ~17 kB grey token seen for library.playstation.com when DDG has no real icon */
  "30d839f62e3166c500432fe8098532f8704be7d1eae67bbf239252bdfa43bd13",
]);

async function sha256HexOfArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** In-memory: bookmark URL → final URL after HTTP redirects (favicon probes use the final origin). */
const redirectCache = new Map<string, { effectiveUrl: string; at: number }>();
const REDIRECT_CACHE_TTL_MS = 60 * 60 * 1000;

/** Many sites stall or ignore HEAD; keep this tight so the UI falls back quickly. */
const REDIRECT_FETCH_TIMEOUT_MS = 3500;

/** Max concurrent image probes across all bookmarks (reduces tab jank on cold cache). */
const PROBE_GLOBAL_MAX = 8;

/** Skip manifest bodies larger than this (CPU / memory guard). */
const MANIFEST_MAX_BODY_CHARS = 262_144;

/** Max `icons` entries read from manifest JSON before scoring. */
const MANIFEST_ICONS_ARRAY_CAP = 48;

const redirectInFlight = new Map<string, Promise<string>>();

let probeSlotsUsed = 0;
const probeSlotWaiters: Array<() => void> = [];

async function acquireProbeSlot(): Promise<void> {
  if (probeSlotsUsed < PROBE_GLOBAL_MAX) {
    probeSlotsUsed++;
    return;
  }
  await new Promise<void>((resolve) => {
    probeSlotWaiters.push(resolve);
  });
  probeSlotsUsed++;
}

function releaseProbeSlot(): void {
  probeSlotsUsed--;
  const next = probeSlotWaiters.shift();
  if (next) next();
}

function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), REDIRECT_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(id),
  );
}

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Follow redirects and return `Response.url` (post-redirect). Uses HEAD first,
 * GET on 405/501, then GET if HEAD errors or times out. Results are cached for
 * one hour **only after a completed fetch** (timeouts do not cache, so we can
 * retry). Concurrent callers for the same bookmark URL share one network fetch.
 */
export async function resolveUrlAfterRedirects(
  fullUrl: string,
  alive: () => boolean,
): Promise<string> {
  const parsed = parseBookmarkUrl(fullUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return fullUrl;
  }

  const key = parsed.href;
  const hit = redirectCache.get(key);
  if (hit && Date.now() - hit.at < REDIRECT_CACHE_TTL_MS) {
    return hit.effectiveUrl;
  }

  let pending = redirectInFlight.get(key);
  if (!pending) {
    pending = (async (): Promise<string> => {
      const baseInit: RequestInit = {
        redirect: "follow",
        credentials: "omit",
      };

      let effectiveUrl = fullUrl;
      let shouldCache = false;

      const applyResponse = (res: Response) => {
        effectiveUrl = res.url || fullUrl;
        shouldCache = true;
      };

      try {
        const res = await fetchWithTimeout(fullUrl, { method: "HEAD", ...baseInit });
        applyResponse(res);

        if (res.status === 405 || res.status === 501) {
          const res2 = await fetchWithTimeout(fullUrl, {
            method: "GET",
            ...baseInit,
          });
          applyResponse(res2);
          await cancelBody(res2);
        }
      } catch {
        try {
          const res = await fetchWithTimeout(fullUrl, {
            method: "GET",
            ...baseInit,
          });
          applyResponse(res);
          await cancelBody(res);
        } catch {
          effectiveUrl = fullUrl;
        }
      }

      if (shouldCache) {
        redirectCache.set(key, { effectiveUrl, at: Date.now() });
      }
      return effectiveUrl;
    })().finally(() => {
      redirectInFlight.delete(key);
    });

    redirectInFlight.set(key, pending);
  }

  const effectiveUrl = await pending;
  if (!alive()) return fullUrl;
  return effectiveUrl;
}

/**
 * Low-res favicon shown immediately while HQ sources resolve. Chrome uses the
 * built-in `/_favicon/` cache (fast). Non-Chrome builds use Google S2 only when
 * `externalFaviconProviders` is true (otherwise null — no third-party leak).
 */
export function getPlaceholderFaviconUrl(
  fullUrl: string,
  externalFaviconProviders = true,
): string | null {
  const parsed = parseBookmarkUrl(fullUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null;
  }
  if (typeof __CHROME__ !== "undefined" && __CHROME__) {
    return `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=32`;
  }
  if (!externalFaviconProviders) return null;
  const hosts = mirrorHostnamesForFavicon(parsed.hostname);
  const root = hosts[0] ?? parsed.hostname.replace(/^www\./i, "");
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(root)}&sz=32`;
}

/**
 * Chrome-only: large native favicon URL for immediate HQ display while
 * {@link resolveFaviconForBookmark} refines (manifest / mirrors).
 */
export function getChromeFastHqFaviconUrl(fullUrl: string): string | null {
  if (typeof __CHROME__ === "undefined" || !__CHROME__) return null;
  const parsed = parseBookmarkUrl(fullUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null;
  }
  return `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=256`;
}

export async function readFaviconCache(
  bookmarkUrl: string,
  externalFaviconProviders = true,
): Promise<CacheEntry | null> {
  const key = bookmarkFaviconStorageKey(bookmarkUrl, externalFaviconProviders);
  if (!key) return null;

  const mem = memory.get(key);
  if (mem && isFresh(mem)) return mem;
  if (mem) memory.delete(key);

  try {
    const disk = await get<CacheEntry>(key);
    if (!disk || !isFresh(disk)) return null;
    memory.set(key, disk);
    return disk;
  } catch {
    return null;
  }
}

export async function writeFaviconCache(
  bookmarkUrl: string,
  pick: Pick<FaviconPick, "url" | "width">,
  externalFaviconProviders = true,
) {
  if (isDiscouragedDdgPngIconUrl(pick.url)) return;
  if (isDuckDuckGoIp3IcoUrl(pick.url)) return;
  const key = bookmarkFaviconStorageKey(bookmarkUrl, externalFaviconProviders);
  if (!key) return;

  const entry: CacheEntry = {
    url: pick.url,
    width: pick.width,
    savedAt: Date.now(),
  };
  memory.set(key, entry);
  try {
    await set(key, entry);
  } catch {
    /* private mode / quota */
  }
}

/** Higher = preferred when widths tie (same decoded pixel size). */
function typeRank(t: FaviconCandidateType): number {
  switch (t) {
    case "cache":
      return 800;
    case "manifest":
      /* First-party PWA icons from webmanifest — usually the best bitmap. */
      return 700;
    case "rootsvg":
      /* Same-origin /favicon.svg, /icon.svg — vector, first-party. */
      return 650;
    case "rootico":
      /* Same-origin /favicon.ico — often 32–48px but sometimes the best raster. */
      return 640;
    case "gstatic":
      /* Google faviconV2 */
      return 600;
    case "google":
      /* Slight tie-break over Icon Horse / Unavatar / DDG when widths match. */
      return 560;
    case "iconhorse":
      return 500;
    case "unavatar":
      return 490;
    case "duckduckgo":
      return 250;
    case "native-lg":
    case "native":
      return 220;
    case "apple":
    case "apple-pre":
      return 100;
    default:
      return 0;
  }
}

function sortByWidthThenRank(a: FaviconPick, b: FaviconPick): number {
  if (b.width !== a.width) return b.width - a.width;
  return typeRank(b.type) - typeRank(a.type);
}

/** Same `url` string keeps the candidate with higher `typeRank`; first-seen order preserved. */
function dedupeFaviconPicksByUrl(picks: FaviconPick[]): FaviconPick[] {
  const winner = new Map<string, FaviconPick>();
  for (const c of picks) {
    const w = winner.get(c.url);
    if (!w || typeRank(c.type) > typeRank(w.type)) winner.set(c.url, c);
  }
  const out: FaviconPick[] = [];
  const emitted = new Set<string>();
  for (const c of picks) {
    if (emitted.has(c.url)) continue;
    emitted.add(c.url);
    const w = winner.get(c.url);
    if (w) out.push(w);
  }
  return out;
}

function bestOfGroup(picks: FaviconPick[]): FaviconPick | null {
  if (picks.length === 0) return null;
  return [...picks].sort(sortByWidthThenRank)[0];
}

/** Prefer any other CDN mirror; only use DuckDuckGo ICO when nothing else loaded. */
function bestCdnMirrorPreferDdgLast(cdns: FaviconPick[]): FaviconPick | null {
  const nonDdg = cdns.filter((r) => r.type !== "duckduckgo");
  const ddgOnly = cdns.filter((r) => r.type === "duckduckgo");
  return bestOfGroup(nonDdg) ?? bestOfGroup(ddgOnly);
}

const CDN_TYPES: FaviconCandidateType[] = [
  "gstatic",
  "google",
  "iconhorse",
  "unavatar",
  "duckduckgo",
];

function isCdnType(t: FaviconCandidateType): boolean {
  return CDN_TYPES.includes(t);
}

function isFirstPartyType(t: FaviconCandidateType): boolean {
  return (
    t === "manifest" ||
    t === "rootsvg" ||
    t === "rootico" ||
    t === "apple" ||
    t === "apple-pre" ||
    t === "cache"
  );
}

/**
 * Prefer a CDN decode over Chromium `/_favicon/` when the CDN met a minimum size,
 * because native often upscales a tiny favicon to a large blurry canvas. If
 * every CDN is tiny, fall back to whichever of CDN vs native decodes larger.
 */
function pickNativeVsCdn(
  bestCdn: FaviconPick | null,
  bestNative: FaviconPick | null,
): FaviconPick | null {
  if (!bestCdn && !bestNative) return null;
  if (!bestNative) return bestCdn;
  if (!bestCdn) return bestNative;
  /* Large-decoding DDG ICO is often a generic placeholder; prefer a decent Chrome native. */
  if (
    bestCdn.type === "duckduckgo" &&
    bestNative.width >= FAVICON_MIN_QUALITY_PX
  ) {
    return bestNative;
  }
  if (bestCdn.width >= FAVICON_MIN_QUALITY_PX) return bestCdn;
  return bestNative.width > bestCdn.width ? bestNative : bestCdn;
}

/**
 * Among third-party mirrors (Google, gstatic, DuckDuckGo ICO; Icon Horse + Unavatar
 * only in the manual picker — monthly / anonymous quotas),
 * the **largest decoded** image wins; ties use `typeRank` (Google slightly above Icon Horse
 * and DDG). Chromium native is only preferred when CDNs failed or returned unusably
 * small assets.
 *
 * **Apple-touch** (`apple` / `apple-pre`): any successful same-origin touch-icon decode
 * wins over manifest, other first-party picks, mirrors, and native.
 *
 * DuckDuckGo ICO is excluded from ranking whenever **any** other candidate remains
 * (it often decodes large generic art); it is only used when DDG is the sole option.
 */
export function pickBestFavicon(results: FaviconPick[]): FaviconPick | null {
  const filtered = results.filter((r) => !isDiscouragedDdgPngIconUrl(r.url));
  if (filtered.length === 0) return null;

  const hasNonDdg = filtered.some((r) => r.type !== "duckduckgo");
  const pool = hasNonDdg
    ? filtered.filter((r) => r.type !== "duckduckgo")
    : filtered;

  const apples = pool.filter((r) => r.type === "apple" || r.type === "apple-pre");
  const bestApple = bestOfGroup(apples);
  if (bestApple && bestApple.width > 0) return bestApple;

  const rootSvgs = pool.filter((r) => r.type === "rootsvg");
  const bestRootSvg = bestOfGroup(rootSvgs);
  if (bestRootSvg && bestRootSvg.width > 0) return bestRootSvg;

  const cdns = pool.filter((r) => isCdnType(r.type));
  const natives = pool.filter((r) => r.type === "native" || r.type === "native-lg");
  const firstParty = pool.filter((r) => isFirstPartyType(r.type));

  const bestCdn = bestCdnMirrorPreferDdgLast(cdns);
  const bestNative = bestOfGroup(natives);
  const bestFp = bestOfGroup(firstParty);

  const core = pickNativeVsCdn(bestCdn, bestNative);

  if (bestFp && core) {
    if (bestFp.width > core.width) return bestFp;
    if (bestFp.width === core.width && typeRank(bestFp.type) > typeRank(core.type)) {
      return bestFp;
    }
  }
  if (bestFp && !core) return bestFp;

  return core ?? bestFp;
}

const MANIFEST_PATHS = [
  "/site.webmanifest",
  "/manifest.webmanifest",
  "/manifest.json",
  "/webmanifest.json",
];

/** Common `apple-touch-icon-{N}x{N}.png` sizes seen in the wild (same-origin probes). */
const APPLE_TOUCH_ICON_PX = [180, 167, 152, 120, 76] as const;

/** Treat smaller same-origin touch decodes as low-confidence fallbacks. */
const APPLE_TOUCH_TRUST_WIDTH_PX = 96;

interface ManifestIconEntry {
  src: string;
  sizes?: string;
  type?: string;
}

/** Largest dimension declared in a `sizes` string (e.g. "192x192 512x512"). */
export function inferLargestSizeFromManifestSizes(sizes?: string): number {
  if (!sizes || !sizes.trim()) return 0;
  let max = 0;
  for (const part of sizes.split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/i.exec(part.trim());
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      max = Math.max(max, a, b);
    }
  }
  return max;
}

/** Sort key for manifest icons: SVGs are treated as high-res for pickBestFavicon. */
export function manifestIconSortWidth(icon: ManifestIconEntry): number {
  const srcLower = icon.src.trim().toLowerCase();
  const isSvg =
    srcLower.endsWith(".svg") ||
    (icon.type?.toLowerCase().includes("svg") ?? false);
  const hint = inferLargestSizeFromManifestSizes(icon.sizes);
  return isSvg ? Math.max(hint, 512) : hint;
}

async function fetchManifestIconCandidates(
  origin: string,
  alive: () => boolean,
): Promise<FaviconPick[]> {
  try {
    const base = new URL(origin);
    if (base.protocol !== "http:" && base.protocol !== "https:") return [];
  } catch {
    return [];
  }

  for (const path of MANIFEST_PATHS) {
    if (!alive()) return [];
    try {
      const res = await fetch(`${origin}${path}`, {
        credentials: "omit",
        cache: "force-cache",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > MANIFEST_MAX_BODY_CHARS) continue;
      if (!alive()) return [];
      const data = JSON.parse(text) as { icons?: ManifestIconEntry[] };
      const rawIcons = Array.isArray(data.icons) ? data.icons : [];
      if (rawIcons.length === 0) continue;
      const icons = rawIcons.slice(0, MANIFEST_ICONS_ARRAY_CAP);

      const picks: FaviconPick[] = [];
      const seen = new Set<string>();
      for (const icon of icons) {
        if (!icon.src?.trim()) continue;
        let href: string;
        try {
          href = new URL(icon.src.trim(), origin).href;
        } catch {
          continue;
        }
        if (seen.has(href)) continue;
        seen.add(href);
        picks.push({
          url: href,
          width: manifestIconSortWidth(icon),
          type: "manifest",
        });
      }
      picks.sort((a, b) => b.width - a.width);
      return picks.slice(0, 10);
    } catch {
      continue;
    }
  }
  return [];
}

function tier1Candidates(parsed: URL, fullUrl: string): FaviconPick[] {
  const origin = parsed.origin;
  const list: FaviconPick[] = [];
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    for (const path of ["/favicon.svg", "/icon.svg"]) {
      list.push({
        url: `${origin}${path}`,
        width: 0,
        type: "rootsvg",
      });
    }
    list.push({
      url: `${origin}/favicon.ico`,
      width: 0,
      type: "rootico",
    });
    for (const px of APPLE_TOUCH_ICON_PX) {
      list.push({
        url: `${origin}/apple-touch-icon-${px}x${px}.png`,
        width: 0,
        type: "apple",
      });
    }
  }
  if (typeof __CHROME__ !== "undefined" && __CHROME__) {
    /* Request the largest sizes first; Chrome returns decoded pixels in naturalWidth. */
    for (const size of [256, 192, 128]) {
      list.push({
        url: `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=${size}`,
        width: 0,
        type: size >= 192 ? "native-lg" : "native",
      });
    }
  }
  list.push({
    url: `${origin}/apple-touch-icon.png`,
    width: 0,
    type: "apple",
  });
  list.push({
    url: `${origin}/apple-touch-icon-precomposed.png`,
    width: 0,
    type: "apple-pre",
  });
  return list;
}

function tier2Candidates(hostname: string, fullUrl: string): FaviconPick[] {
  return buildMirrorFaviconCandidates(hostname, fullUrl, { pickerMirrors: false });
}

type MirrorFaviconCandidateOptions = {
  /**
   * When true (manual favicon picker), include Icon Horse and Unavatar. Automatic
   * resolution omits both (Icon Horse free-tier monthly cap; Unavatar anonymous 429s).
   */
  pickerMirrors?: boolean;
};

/** One mirror set for a single hostname (see `buildMirrorFaviconCandidates`). */
function buildMirrorFaviconCandidatesForSingleHost(
  mirrorHost: string,
  fullUrl: string,
  options?: MirrorFaviconCandidateOptions,
): FaviconPick[] {
  const pickerMirrors = options?.pickerMirrors === true;
  const rootHost = mirrorHost.replace(/^www\./i, "");
  const d = encodeURIComponent(rootHost);
  const encHost = encodeURIComponent(rootHost);
  const encPage = encodeURIComponent(fullUrl);
  const picks: FaviconPick[] = [
    {
      url: `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encPage}&size=256`,
      width: 0,
      type: "gstatic",
    },
    {
      url: `https://www.google.com/s2/favicons?domain=${d}&sz=256`,
      width: 0,
      type: "google",
    },
  ];
  if (pickerMirrors) {
    picks.push(
      {
        url: `https://icon.horse/icon/${encHost}?size=big`,
        width: 0,
        type: "iconhorse",
      },
      {
        url: `https://unavatar.io/domain/${encHost}`,
        width: 0,
        type: "unavatar",
      },
    );
  }
  picks.push({
    url: `https://icons.duckduckgo.com/ip3/${rootHost}.ico`,
    width: 0,
    type: "duckduckgo",
  });
  return picks;
}

/** Same third-party URLs as automatic resolution (registrable domain first, then full host). */
function buildMirrorFaviconCandidates(
  hostname: string,
  fullUrl: string,
  options?: MirrorFaviconCandidateOptions,
): FaviconPick[] {
  const parts: FaviconPick[] = [];
  for (const host of mirrorHostnamesForFavicon(hostname)) {
    parts.push(...buildMirrorFaviconCandidatesForSingleHost(host, fullUrl, options));
  }
  return dedupeFaviconPicksByUrl(parts);
}

/** One Google faviconV2 URL for stage-A probing (Firefox has no `/_favicon/`). */
function firstGstaticMirrorCandidate(
  hostname: string,
  fullUrl: string,
): FaviconPick | null {
  for (const host of mirrorHostnamesForFavicon(hostname)) {
    const singles = buildMirrorFaviconCandidatesForSingleHost(host, fullUrl, {
      pickerMirrors: false,
    });
    const g = singles.find((c) => c.type === "gstatic");
    if (g) return g;
  }
  return null;
}

export interface FaviconPickerOption {
  name: string;
  url: string;
}

function mergePickerOptionsPreferFirst(
  primary: FaviconPickerOption[],
  secondary: FaviconPickerOption[],
): FaviconPickerOption[] {
  const seen = new Set<string>();
  const out: FaviconPickerOption[] = [];
  for (const o of primary) {
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    out.push(o);
  }
  for (const o of secondary) {
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    out.push(o);
  }
  return out;
}

/** First row wins when the same mirror URL appears for multiple host labels. */
function dedupePickerOptionsByUrlPreferFirst(
  items: FaviconPickerOption[],
): FaviconPickerOption[] {
  const seen = new Set<string>();
  const out: FaviconPickerOption[] = [];
  for (const o of items) {
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    out.push(o);
  }
  return out;
}

/** Normalize bookmark URL inside `/_favicon/?pageUrl=` for deduping http vs https. */
function normalizedInnerBookmarkForFaviconKey(pageParam: string): string {
  try {
    const inner = new URL(decodeURIComponent(pageParam));
    inner.protocol = "https:";
    inner.hostname = inner.hostname.replace(/^www\./i, "");
    inner.hash = "";
    inner.search = "";
    if (inner.pathname.length > 1 && inner.pathname.endsWith("/")) {
      inner.pathname = inner.pathname.slice(0, -1);
    }
    return inner.href;
  } catch {
    try {
      return decodeURIComponent(pageParam);
    } catch {
      return pageParam;
    }
  }
}

function pickerRowLogicalDedupeKey(row: FaviconPickerOption): string {
  try {
    const u = new URL(row.url);
    if (u.pathname === "/_favicon/") {
      const raw = u.searchParams.get("pageUrl");
      if (raw != null && raw !== "") {
        const nk = normalizedInnerBookmarkForFaviconKey(raw);
        const sz = u.searchParams.get("size") ?? "";
        return `_favicon:${sz}:${nk}`;
      }
    }
    const h = u.hostname.replace(/^www\./i, "");
    return `path:${h}|${u.pathname.toLowerCase()}`;
  } catch {
    return row.url;
  }
}

function preferPickerOptionDedupeWinner(
  a: FaviconPickerOption,
  b: FaviconPickerOption,
): FaviconPickerOption {
  try {
    const ua = new URL(a.url);
    const ub = new URL(b.url);
    if (ua.pathname === "/_favicon/" && ub.pathname === "/_favicon/") {
      const pa = ua.searchParams.get("pageUrl") ?? "";
      const pb = ub.searchParams.get("pageUrl") ?? "";
      let aHttps = false;
      let bHttps = false;
      try {
        aHttps = new URL(decodeURIComponent(pa)).protocol === "https:";
      } catch {
        aHttps = pa.includes("https%3A");
      }
      try {
        bHttps = new URL(decodeURIComponent(pb)).protocol === "https:";
      } catch {
        bHttps = pb.includes("https%3A");
      }
      if (aHttps !== bHttps) return bHttps ? b : a;
      const sa = parseInt(ua.searchParams.get("size") ?? "0", 10);
      const sb = parseInt(ub.searchParams.get("size") ?? "0", 10);
      if (sa !== sb) return sb > sa ? b : a;
      return a;
    }
    const ha = ua.hostname.replace(/^www\./i, "");
    const hb = ub.hostname.replace(/^www\./i, "");
    if (ha === hb && ua.pathname.toLowerCase() === ub.pathname.toLowerCase()) {
      if (ua.protocol !== ub.protocol) return ub.protocol === "https:" ? b : a;
    }
  } catch {
    /* ignore */
  }
  return a;
}

/** Collapse `/_favicon/?pageUrl=http…` vs `…https…` and same-path http/https asset rows. */
function dedupePickerMergeHttpDuplicates(rows: FaviconPickerOption[]): FaviconPickerOption[] {
  const winners = new Map<string, FaviconPickerOption>();
  for (const row of rows) {
    const k = pickerRowLogicalDedupeKey(row);
    const prev = winners.get(k);
    winners.set(k, prev ? preferPickerOptionDedupeWinner(prev, row) : row);
  }
  const seen = new Set<string>();
  const out: FaviconPickerOption[] = [];
  for (const row of rows) {
    const k = pickerRowLogicalDedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    const w = winners.get(k);
    if (w) out.push(w);
  }
  return out;
}

function matchHtmlAttribute(fragment: string, attr: string): string | null {
  const re = new RegExp(
    String.raw`${attr}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`,
    "i",
  );
  const m = re.exec(fragment);
  if (!m) return null;
  const v = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  return v || null;
}



function isHttpOrHttpsUrl(u: URL): boolean {
  return u.protocol === "http:" || u.protocol === "https:";
}

const PICKER_HTML_FETCH_TIMEOUT_MS = 12_000;
const PICKER_HTML_MAX_READ_BYTES = 384 * 1024;
const HTML_APPLE_TOUCH_MAX = 8;

function relTokensIncludeAppleTouchOnly(rel: string): boolean {
  return rel
    .toLowerCase()
    .split(/\s+/)
    .some(
      (t) =>
        t === "apple-touch-icon" || t === "apple-touch-icon-precomposed",
    );
}

/**
 * Apple-touch `<link rel="apple-touch-icon…" href>` only (many sites host these on a
 * CDN; same-origin `/apple-touch-icon.png` probes miss them).
 */
export function appleTouchHtmlPicksFromLinkTags(
  html: string,
  documentUrl: string,
): FaviconPick[] {
  let base: URL;
  try {
    base = new URL(documentUrl);
  } catch {
    return [];
  }
  if (!isHttpOrHttpsUrl(base)) return [];

  const out: FaviconPick[] = [];
  const linkRe = /<link\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const frag = m[1] ?? "";
    const hrefRaw = matchHtmlAttribute(frag, "href");
    if (!hrefRaw) continue;
    const rel = matchHtmlAttribute(frag, "rel");
    if (!rel || !relTokensIncludeAppleTouchOnly(rel)) continue;
    let resolved: URL;
    try {
      resolved = new URL(hrefRaw, base);
    } catch {
      continue;
    }
    if (!isHttpOrHttpsUrl(resolved)) continue;
    const isPre = rel.toLowerCase().includes("precomposed");
    out.push({
      url: resolved.href,
      width: 0,
      type: isPre ? "apple-pre" : "apple",
    });
    if (out.length >= HTML_APPLE_TOUCH_MAX) break;
  }
  return dedupeFaviconPicksByUrl(out);
}

async function gatherHtmlAppleTouchFaviconPicks(
  pageUrl: string,
  alive: () => boolean,
): Promise<FaviconPick[]> {
  if (!alive()) return [];
  const got = await fetchHtmlHeadSnippetForPicker(pageUrl);
  if (!alive() || !got) return [];
  return appleTouchHtmlPicksFromLinkTags(got.html, got.finalUrl);
}

async function fetchHtmlHeadSnippetForPicker(
  pageUrl: string,
): Promise<{ html: string; finalUrl: string } | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await fetch(pageUrl, {
      method: "GET",
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(PICKER_HTML_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1",
      },
    });
    if (!res.ok || !res.body) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (
      ct &&
      !/\btext\/html\b/i.test(ct) &&
      !/\bapplication\/xhtml\+xml\b/i.test(ct) &&
      !/\bapplication\/xml\b/i.test(ct)
    ) {
      return null;
    }

    const finalUrl = res.url || pageUrl;
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = "";
    while (total < PICKER_HTML_MAX_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(text)) break;
    }
    await reader.cancel().catch(() => {});
    return { html: text, finalUrl };
  } catch {
    try {
      await reader?.cancel();
    } catch {
      /* ignore */
    }
    return null;
  }
}

function buildPickerOptionsForPage(
  parsed: URL,
  pageUrl: string,
  externalFaviconProviders: boolean,
): FaviconPickerOption[] {
  const out: FaviconPickerOption[] = [];

  if (typeof __CHROME__ !== "undefined" && __CHROME__) {
    out.push({
      name: "Chrome native (256px)",
      url: `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=256`,
    });
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    const origin = parsed.origin;
    out.push(
      { name: "Favicon.svg (same origin)", url: `${origin}/favicon.svg` },
      { name: "Icon.svg (same origin)", url: `${origin}/icon.svg` },
      { name: "Favicon.ico (same origin)", url: `${origin}/favicon.ico` },
    );
    const largestApple = APPLE_TOUCH_ICON_PX[0];
    out.push({
      name: `Apple touch ${largestApple}×${largestApple}`,
      url: `${origin}/apple-touch-icon-${largestApple}x${largestApple}.png`,
    });
    out.push(
      {
        name: "Apple touch icon",
        url: `${origin}/apple-touch-icon.png`,
      },
      {
        name: "Apple touch (precomposed)",
        url: `${origin}/apple-touch-icon-precomposed.png`,
      },
    );
  }

  if (!externalFaviconProviders) {
    return dedupePickerOptionsByUrlPreferFirst(out);
  }

  const mirrorLabels: Partial<Record<FaviconCandidateType, string>> = {
    gstatic: "Google faviconV2",
    google: "Google S2 (256)",
    iconhorse: "Icon Horse",
    unavatar: "Unavatar",
    duckduckgo: "DuckDuckGo ICO",
  };
  for (const host of mirrorHostnamesForFavicon(parsed.hostname)) {
    const singles = buildMirrorFaviconCandidatesForSingleHost(host, pageUrl, {
      pickerMirrors: true,
    });
    for (const c of singles) {
      out.push({
        name: `${mirrorLabels[c.type] ?? c.type} · ${host}`,
        url: c.url,
      });
    }
  }

  return dedupePickerOptionsByUrlPreferFirst(out);
}

/**
 * Labels + URLs for the manual favicon picker (right-click). Kept in sync with
 * `tier1Candidates` + `tier2Candidates` / `buildMirrorFaviconCandidates`.
 *
 * The modal only **shows** candidates whose `<img>` loads (`onLoad`); fixed URLs
 * that 404 (common on SPAs that host touch icons on a CDN) stay hidden — so two
 * sites can show different counts even though the same list is generated.
 *
 * Saved-bookmark options are built **before** awaiting redirect resolution so the
 * list stays responsive. When the URL redirects, **final** options are merged
 * (deduped by icon URL). Mirrors include the registrable domain first, then the
 * full host (`playstation.com`, then `library.playstation.com`). Chrome lists a
 * single largest `/_favicon/` size; Apple lists the largest declared touch size only.
 */
export type FaviconPickerLoadOptions = {
  /** When false, omit third-party mirror URLs (same as dial “privacy” mode). Default true. */
  externalFaviconProviders?: boolean;
};

export async function getFaviconPickerCandidates(
  fullUrl: string,
  options?: FaviconPickerLoadOptions,
): Promise<FaviconPickerOption[]> {
  const external = options?.externalFaviconProviders ?? true;
  const parsedInit = parseBookmarkUrl(fullUrl);
  if (
    !parsedInit ||
    (parsedInit.protocol !== "http:" && parsedInit.protocol !== "https:")
  ) {
    return [];
  }

  const fromBookmark = buildPickerOptionsForPage(parsedInit, fullUrl, external);

  const effectiveUrl = await resolveUrlAfterRedirects(fullUrl, () => true);
  const parsedEff = parseBookmarkUrl(effectiveUrl);
  if (
    !parsedEff ||
    (parsedEff.protocol !== "http:" && parsedEff.protocol !== "https:")
  ) {
    return dedupePickerMergeHttpDuplicates(fromBookmark);
  }

  const fromEffective = buildPickerOptionsForPage(parsedEff, effectiveUrl, external);
  return dedupePickerMergeHttpDuplicates(
    mergePickerOptionsPreferFirst(fromBookmark, fromEffective),
  );
}

function probeImageSrcForPick(
  src: string,
  candidate: FaviconPick,
  alive: () => boolean,
): Promise<FaviconPick | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (result: FaviconPick | null) => {
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };
    img.onload = () => {
      if (!alive()) return done(null);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < 2 || h < 2) return done(null);
      /* Favorites-style: Chrome sometimes returns a 16×16 generic for a large `size=`; treat as miss. */
      if (
        (candidate.type === "native" || candidate.type === "native-lg") &&
        w === 16 &&
        h === 16
      ) {
        return done(null);
      }
      done({
        url: candidate.url,
        width: Math.max(w, h),
        type: candidate.type,
      });
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

async function probeOne(
  candidate: FaviconPick,
  alive: () => boolean,
): Promise<FaviconPick | null> {
  if (!alive()) return null;

  if (candidate.type === "duckduckgo") {
    try {
      const res = await fetch(candidate.url, {
        credentials: "omit",
        cache: "force-cache",
        signal: AbortSignal.timeout(7000),
      });
      if (!alive()) return null;
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (!alive()) return null;
      const hex = await sha256HexOfArrayBuffer(buf);
      if (KNOWN_DDG_PLACEHOLDER_SHA256.has(hex)) return null;

      const ct = res.headers.get("content-type") ?? "application/octet-stream";
      const blob = new Blob([buf], { type: ct });
      const objectUrl = URL.createObjectURL(blob);
      try {
        return await probeImageSrcForPick(objectUrl, candidate, alive);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return probeImageSrcForPick(candidate.url, candidate, alive);
    }
  }

  return probeImageSrcForPick(candidate.url, candidate, alive);
}

/**
 * Runs image probes with a global concurrency cap. When `minWidthEarlyExit` is set,
 * stops starting new probes once {@link pickBestFavicon} reaches that decoded width
 * (in-flight probes still finish).
 */
async function probeQueueWithSlots(
  candidates: FaviconPick[],
  alive: () => boolean,
  options: { minWidthEarlyExit?: number },
): Promise<FaviconPick[]> {
  const queue = dedupeFaviconPicksByUrl(candidates).filter(
    (c) => !isDiscouragedDdgPngIconUrl(c.url),
  );
  const results: FaviconPick[] = [];
  const minW = options.minWidthEarlyExit;
  let stop = false;

  const goodEnough = () => {
    if (minW === undefined) return false;
    const b = pickBestFavicon(results);
    return Boolean(b && b.width >= minW);
  };

  async function worker(): Promise<void> {
    while (!stop && alive()) {
      if (goodEnough()) {
        stop = true;
        break;
      }
      const c = queue.shift();
      if (!c) break;
      await acquireProbeSlot();
      try {
        const r = await probeOne(c, alive);
        if (r && alive()) results.push(r);
      } finally {
        releaseProbeSlot();
      }
    }
  }

  const nWorkers =
    queue.length === 0 ? 1 : Math.min(PROBE_GLOBAL_MAX, queue.length);
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
  return results;
}

/**
 * Stage A: manifest + same-origin + Chrome native (+ one gstatic mirror when allowed).
 * Stage B (only if A has no icon ≥ {@link FAVICON_MIN_QUALITY_PX}): remaining mirrors.
 */
async function probePageForFavicon(
  pageUrl: string,
  alive: () => boolean,
  externalFaviconProviders: boolean,
): Promise<FaviconPick | null> {
  const parsed = parseBookmarkUrl(pageUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null;
  }

  if (!alive()) return null;
  const manifest = await fetchManifestIconCandidates(parsed.origin, alive);
  if (!alive()) return null;

  const t1 = tier1Candidates(parsed, pageUrl);
  /*
   * Same-origin Apple touch URLs must run before the rest of stage A: otherwise
   * `minWidthEarlyExit` stops dequeuing as soon as Chrome `/_favicon/` (or a mirror)
   * decodes “large” dimensions from an upscaled tiny bitmap, and we never reach
   * `apple-touch-icon.png` / sized variants that actually look sharp (e.g. Wikipedia).
   */
  const appleFirst = t1.filter((c) => c.type === "apple" || c.type === "apple-pre");
  const t1Rest = t1.filter((c) => c.type !== "apple" && c.type !== "apple-pre");

  const appleResults = await probeQueueWithSlots(appleFirst, alive, {});
  if (!alive()) return null;

  let combinedAppleResults = appleResults;
  const sameOriginApplePick = pickBestFavicon(appleResults);
  const sameOriginApple =
    sameOriginApplePick &&
    (sameOriginApplePick.type === "apple" || sameOriginApplePick.type === "apple-pre")
      ? sameOriginApplePick
      : null;
  if (sameOriginApple && sameOriginApple.width >= APPLE_TOUCH_TRUST_WIDTH_PX) {
    return sameOriginApple;
  }

  const t2 = externalFaviconProviders
    ? tier2Candidates(parsed.hostname, pageUrl)
    : [];
  const gstaticLead = externalFaviconProviders
    ? firstGstaticMirrorCandidate(parsed.hostname, pageUrl)
    : null;
  const stageA = dedupeFaviconPicksByUrl([
    ...manifest,
    ...t1Rest,
    ...(gstaticLead ? [gstaticLead] : []),
  ]).filter((c) => !isDiscouragedDdgPngIconUrl(c.url));

  const stageAUrls = new Set(stageA.map((c) => c.url));
  const stageB = externalFaviconProviders
    ? dedupeFaviconPicksByUrl(t2).filter(
        (c) => !stageAUrls.has(c.url) && !isDiscouragedDdgPngIconUrl(c.url),
      )
    : [];

  const resultsA = await probeQueueWithSlots(stageA, alive, {
    minWidthEarlyExit: FAVICON_MIN_QUALITY_PX,
  });
  if (!alive()) return null;
  const bestA = pickBestFavicon([...combinedAppleResults, ...resultsA]);
  if (bestA && bestA.type === "rootsvg") {
    return bestA;
  }

  if (!sameOriginApple || sameOriginApple.width < APPLE_TOUCH_TRUST_WIDTH_PX) {
    const bestAType = bestA?.type;
    const shouldTryHtmlApple =
      sameOriginApple != null ||
      bestAType === "native" ||
      bestAType === "native-lg" ||
      bestAType === "rootico" ||
      bestAType === "manifest" ||
      bestAType === "google" ||
      bestAType === "gstatic" ||
      bestAType === "duckduckgo";
    if (shouldTryHtmlApple) {
      const htmlAppleCandidates = await gatherHtmlAppleTouchFaviconPicks(pageUrl, alive);
      if (alive() && htmlAppleCandidates.length > 0) {
        const htmlAppleResults = await probeQueueWithSlots(
          htmlAppleCandidates,
          alive,
          {},
        );
        combinedAppleResults = [...combinedAppleResults, ...htmlAppleResults];
        const bestAfterHtmlApple = pickBestFavicon([
          ...combinedAppleResults,
          ...resultsA,
        ]);
        if (
          bestAfterHtmlApple &&
          (bestAfterHtmlApple.type === "apple" ||
            bestAfterHtmlApple.type === "apple-pre")
        ) {
          return bestAfterHtmlApple;
        }
      }
    }
  }

  const bestAfterAppleFallback = pickBestFavicon([
    ...combinedAppleResults,
    ...resultsA,
  ]);
  if (bestAfterAppleFallback && bestAfterAppleFallback.width >= FAVICON_MIN_QUALITY_PX) {
    return bestAfterAppleFallback;
  }

  const resultsB = await probeQueueWithSlots(stageB, alive, {});
  if (!alive()) return null;
  return pickBestFavicon([...combinedAppleResults, ...resultsA, ...resultsB]);
}

export type ResolveFaviconForBookmarkOptions = {
  /** When false, only first-party + Chrome `/_favicon/` (no third-party mirrors). Default true. */
  externalFaviconProviders?: boolean;
};

/**
 * Resolve best favicon for a bookmark: follow redirects, then probe the saved URL and
 * (when it differs) the final URL, merging with {@link pickBestFavicon}. Cache + in-flight
 * dedupe use the **saved bookmark URL** (normalized `href`), not the post-login host.
 * @param alive return false after effect cleanup / URL change to ignore late probes
 */
export async function resolveFaviconForBookmark(
  fullUrl: string,
  alive: () => boolean,
  options?: ResolveFaviconForBookmarkOptions,
): Promise<FaviconPick | null> {
  const external = options?.externalFaviconProviders ?? true;
  const storageKey = bookmarkFaviconStorageKey(fullUrl, external);
  if (!storageKey) return null;

  const cached = await readFaviconCache(fullUrl, external);
  if (
    cached &&
    isFresh(cached) &&
    alive() &&
    !isDiscouragedDdgPngIconUrl(cached.url) &&
    !isDuckDuckGoIp3IcoUrl(cached.url)
  ) {
    return {
      url: cached.url,
      width: cached.width,
      type: "cache",
    };
  }

  let pending = inFlightByBookmarkHref.get(storageKey);
  if (!pending) {
    pending = (async () => {
      try {
        const effectiveUrl = await resolveUrlAfterRedirects(fullUrl, alive);
        if (!alive()) return null;

        if (urlsEquivalentBookmarks(fullUrl, effectiveUrl)) {
          return await probePageForFavicon(fullUrl, alive, external);
        }

        if (urlsDifferOnlyByScheme(fullUrl, effectiveUrl)) {
          return await probePageForFavicon(effectiveUrl, alive, external);
        }

        const effectivePick = await probePageForFavicon(
          effectiveUrl,
          alive,
          external,
        );
        if (!alive()) return null;
        if (effectivePick) return effectivePick;

        return await probePageForFavicon(fullUrl, alive, external);
      } catch {
        return null;
      } finally {
        inFlightByBookmarkHref.delete(storageKey);
      }
    })();
    inFlightByBookmarkHref.set(storageKey, pending);
  }

  const best = await pending;
  if (!alive()) return null;
  if (best) {
    const prev = await readFaviconCache(fullUrl, external);
    const improved =
      !prev ||
      best.url !== prev.url ||
      best.width > prev.width ||
      best.type !== "cache";
    if (improved) void writeFaviconCache(fullUrl, best, external);
  }
  return best;
}
