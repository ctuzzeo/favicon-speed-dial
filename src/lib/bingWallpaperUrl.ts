const BING_HOST = "www.bing.com";

function normalizeHttpsBingUrl(candidate: string): string | null {
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:") return null;
    if (u.hostname !== BING_HOST) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Accepts Bing HPImageArchive `images[].url` (path or absolute) and returns a
 * safe `https://www.bing.com/...` URL, or null if the value is not allowed.
 */
export function buildBingWallpaperUrlFromHpApiPath(relativeOrAbsolute: string): string | null {
  if (!relativeOrAbsolute || typeof relativeOrAbsolute !== "string") return null;
  const t = relativeOrAbsolute.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    const https = t.replace(/^http:\/\//i, "https://");
    return normalizeHttpsBingUrl(https);
  }
  if (!t.startsWith("/")) return null;
  return normalizeHttpsBingUrl(`https://${BING_HOST}${t}`);
}

/** Re-validates after string substitution (e.g. resolution swap). */
export function assertBingCdnHttpsUrl(url: string): string | null {
  return normalizeHttpsBingUrl(url);
}
