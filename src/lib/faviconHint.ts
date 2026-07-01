/**
 * Synchronous (localStorage) hint of the last resolved favicon for a bookmark, so a page
 * reload can paint the final icon on the first render instead of flashing the placeholder
 * / Chrome-native icon while the async (IDB-backed) resolver re-runs. The resolver still
 * runs on load and rewrites the hint if the favicon changed, so stale hints self-correct.
 * Hints expire after HINT_TTL_MS (same window as the async resolver's cache) so a hint
 * pointing at a remote icon URL can't be replayed indefinitely if resolution stops
 * succeeding for that bookmark.
 */

const HINT_PREFIX = "fs-favhint:";
const HINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FaviconHint = { url: string; width: number };

type StoredFaviconHint = FaviconHint & { savedAt: number };

function hintKey(url: string, external: boolean): string {
  return `${HINT_PREFIX}${external ? "e" : "i"}:${url}`;
}

export function readFaviconHint(
  url: string,
  external: boolean,
): FaviconHint | null {
  const key = hintKey(url, external);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredFaviconHint> | null;
    if (
      parsed &&
      typeof parsed.url === "string" &&
      typeof parsed.width === "number"
    ) {
      if (
        typeof parsed.savedAt !== "number" ||
        Date.now() - parsed.savedAt > HINT_TTL_MS
      ) {
        localStorage.removeItem(key);
        return null;
      }
      return { url: parsed.url, width: parsed.width };
    }
  } catch {
    /* localStorage unavailable / malformed JSON — ignore */
  }
  return null;
}

export function writeFaviconHint(
  url: string,
  external: boolean,
  hint: FaviconHint,
): void {
  try {
    const stored: StoredFaviconHint = { ...hint, savedAt: Date.now() };
    localStorage.setItem(hintKey(url, external), JSON.stringify(stored));
  } catch {
    /* quota exceeded / disabled — non-fatal */
  }
}
