import { get, set } from "idb-keyval";

/** Icons below this width get the soft “plate” framing in the dial UI. */
export const FAVICON_MIN_QUALITY_PX = 48;

/**
 * If a cached icon is at least this wide, skip network probes (saves requests).
 * Keep high so we don’t freeze in a mediocre native/apple pick when Google has sharper art.
 */
const FAVICON_CACHE_SKIP_MIN_PX = 128;

const CACHE_PREFIX = "esd-fav2:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FaviconCandidateType =
  | "manifest"
  | "native"
  | "native-lg"
  | "apple"
  | "apple-pre"
  | "google"
  | "duckduckgo"
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

function cacheKey(hostname: string) {
  return `${CACHE_PREFIX}${hostname}`;
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

export async function readFaviconCache(
  hostname: string,
): Promise<CacheEntry | null> {
  const mem = memory.get(hostname);
  if (mem && isFresh(mem)) return mem;
  if (mem) memory.delete(hostname);

  try {
    const disk = await get<CacheEntry>(cacheKey(hostname));
    if (!disk || !isFresh(disk)) return null;
    memory.set(hostname, disk);
    return disk;
  } catch {
    return null;
  }
}

export async function writeFaviconCache(
  hostname: string,
  pick: Pick<FaviconPick, "url" | "width">,
) {
  const entry: CacheEntry = {
    url: pick.url,
    width: pick.width,
    savedAt: Date.now(),
  };
  memory.set(hostname, entry);
  try {
    await set(cacheKey(hostname), entry);
  } catch {
    /* private mode / quota */
  }
}

/** Higher = preferred when widths tie (same decoded pixel size). */
function typeRank(t: FaviconCandidateType): number {
  switch (t) {
    case "cache":
      return 7;
    case "manifest":
      /* First-party PWA icons from webmanifest — usually the best bitmap. */
      return 6;
    case "google":
      /* At equal dimensions, Google’s asset is often cleaner than upscaled favicons. */
      return 4;
    case "duckduckgo":
      return 3;
    case "native-lg":
    case "native":
      return 2;
    case "apple":
    case "apple-pre":
      return 1;
    default:
      return 0;
  }
}

export function pickBestFavicon(results: FaviconPick[]): FaviconPick | null {
  if (results.length === 0) return null;
  return [...results].sort((a, b) => {
    if (b.width !== a.width) return b.width - a.width;
    return typeRank(b.type) - typeRank(a.type);
  })[0];
}

const MANIFEST_PATHS = [
  "/site.webmanifest",
  "/manifest.webmanifest",
  "/manifest.json",
  "/webmanifest.json",
];

interface ManifestIconEntry {
  src: string;
  sizes?: string;
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
      if (!alive()) return [];
      const data = JSON.parse(text) as { icons?: ManifestIconEntry[] };
      if (!Array.isArray(data.icons) || data.icons.length === 0) continue;

      const picks: FaviconPick[] = [];
      const seen = new Set<string>();
      for (const icon of data.icons) {
        if (!icon.src?.trim()) continue;
        let href: string;
        try {
          href = new URL(icon.src.trim(), origin).href;
        } catch {
          continue;
        }
        if (seen.has(href)) continue;
        seen.add(href);
        const hint = inferLargestSizeFromManifestSizes(icon.sizes);
        picks.push({
          url: href,
          width: hint,
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
  if (typeof __CHROME__ !== "undefined" && __CHROME__) {
    list.push({
      url: `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=256`,
      width: 0,
      type: "native-lg",
    });
    list.push({
      url: `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=128`,
      width: 0,
      type: "native",
    });
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

function tier2Candidates(hostname: string): FaviconPick[] {
  const rootHost = hostname.replace(/^www\./i, "");
  const d = encodeURIComponent(rootHost);
  return [
    {
      url: `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
      width: 0,
      type: "google",
    },
    {
      url: `https://icons.duckduckgo.com/ip3/${rootHost}.ico`,
      width: 0,
      type: "duckduckgo",
    },
  ];
}

function probeOne(
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
      done({
        url: candidate.url,
        width: Math.max(w, h),
        type: candidate.type,
      });
    };
    img.onerror = () => done(null);
    img.src = candidate.url;
  });
}

async function probeMany(
  candidates: FaviconPick[],
  alive: () => boolean,
): Promise<FaviconPick[]> {
  const settled = await Promise.all(
    candidates.map((c) => probeOne(c, alive)),
  );
  return settled.filter((x): x is FaviconPick => x !== null);
}

/**
 * Resolve best favicon URL for a bookmark URL + hostname.
 * @param alive return false after effect cleanup / URL change to ignore late probes
 */
export async function resolveFaviconForBookmark(
  fullUrl: string,
  hostname: string,
  alive: () => boolean,
): Promise<FaviconPick | null> {
  const parsed = parseBookmarkUrl(fullUrl);
  if (!parsed || !alive()) return null;

  const collected: FaviconPick[] = [];
  const cached = await readFaviconCache(hostname);
  if (cached && isFresh(cached) && alive()) {
    collected.push({
      url: cached.url,
      width: cached.width,
      type: "cache",
    });
    if (cached.width >= FAVICON_CACHE_SKIP_MIN_PX) {
      return pickBestFavicon(collected);
    }
  }

  const manifest = await fetchManifestIconCandidates(parsed.origin, alive);
  if (!alive()) return null;

  const t1 = tier1Candidates(parsed, fullUrl);
  const t2 = tier2Candidates(parsed.hostname);
  collected.push(
    ...(await probeMany([...manifest, ...t1, ...t2], alive)),
  );
  if (!alive()) return null;

  const best = pickBestFavicon(collected);

  if (!best || !alive()) return null;

  const improved =
    !cached ||
    best.url !== cached.url ||
    best.width > cached.width ||
    best.type !== "cache";
  if (improved) {
    void writeFaviconCache(hostname, best);
  }

  return best;
}
