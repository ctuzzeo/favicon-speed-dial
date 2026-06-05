/**
 * Synchronous (localStorage) hint of the last resolved favicon for a bookmark, so a page
 * reload can paint the final icon on the first render instead of flashing the placeholder
 * / Chrome-native icon while the async (IDB-backed) resolver re-runs. The resolver still
 * runs on load and rewrites the hint if the favicon changed, so stale hints self-correct.
 */

const HINT_PREFIX = "fs-favhint:";

export type FaviconHint = { url: string; width: number };

function hintKey(url: string, external: boolean): string {
  return `${HINT_PREFIX}${external ? "e" : "i"}:${url}`;
}

export function readFaviconHint(
  url: string,
  external: boolean,
): FaviconHint | null {
  try {
    const raw = localStorage.getItem(hintKey(url, external));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FaviconHint> | null;
    if (
      parsed &&
      typeof parsed.url === "string" &&
      typeof parsed.width === "number"
    ) {
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
    localStorage.setItem(hintKey(url, external), JSON.stringify(hint));
  } catch {
    /* quota exceeded / disabled — non-fatal */
  }
}
