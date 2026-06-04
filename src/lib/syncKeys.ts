/**
 * Per-site storage keys: one entry per hostname instead of a single growing blob.
 *
 * `storage.sync` caps each *item* at ~8 KB but allows ~512 items / 100 KB total. A
 * single `manual-favicons` / `site-image` object would silently stop syncing once it
 * crossed 8 KB; per-site keys keep each entry small so they sync reliably and
 * independently across machines.
 */

export const MANUAL_FAVICON_INFIX = "manual-favicon:";
export const SITE_IMAGE_INFIX = "site-image:";

export function perSiteKey(
  apiVersion: string,
  infix: string,
  host: string,
): string {
  return `${apiVersion}-${infix}${host}`;
}

/** Extract the hostname from a per-site key, or null if it isn't one of this kind. */
export function parsePerSiteKey(
  apiVersion: string,
  infix: string,
  key: string,
): string | null {
  const prefix = `${apiVersion}-${infix}`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/** Collect all per-site entries (host → string value) of one kind from a snapshot. */
export function collectPerSiteEntries(
  snapshot: Record<string, unknown>,
  apiVersion: string,
  infix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    const host = parsePerSiteKey(apiVersion, infix, key);
    if (host && typeof value === "string") out[host] = value;
  }
  return out;
}

/** Merge a legacy single-blob record with per-site entries; per-site wins on conflict. */
export function mergeLegacyAndPerSite(
  legacy: Record<string, string>,
  perSite: Record<string, string>,
): Record<string, string> {
  return { ...legacy, ...perSite };
}
