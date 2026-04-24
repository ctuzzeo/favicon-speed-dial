import type { Bookmarks } from "webextension-polyfill";
import browser from "webextension-polyfill";

import { resolveFaviconForBookmark } from "#lib/faviconResolve";
import { settings } from "#stores/useSettings";

const PREFETCH_CONCURRENCY = 2;

let prefetchScheduled = false;

/** Remaining bookmark URLs for the current page-load prefetch session. */
type PrefetchSlice = { urls: string[]; next: number };

let prefetchSlice: PrefetchSlice | null = null;

/** Serializes prefetch passes (idle kick + visibility resumes). */
let prefetchChain: Promise<void> = Promise.resolve();

let visibilityListenerAttached = false;

function bookmarkTreeRootId(): string {
  return typeof __FIREFOX__ !== "undefined" && __FIREFOX__
    ? "root________"
    : "0";
}

function collectHttpUrls(nodes: Bookmarks.BookmarkTreeNode[] | undefined): string[] {
  const out: string[] = [];
  const walk = (n: Bookmarks.BookmarkTreeNode) => {
    if (n.url) {
      try {
        const u = new URL(n.url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          out.push(n.url);
        }
      } catch {
        /* skip */
      }
    }
    n.children?.forEach(walk);
  };
  for (const node of nodes || []) walk(node);
  return [...new Set(out)];
}

async function runPool(slice: PrefetchSlice, alive: () => boolean): Promise<void> {
  const { urls } = slice;
  async function worker() {
    while (alive()) {
      const idx = slice.next++;
      if (idx >= urls.length) break;
      await resolveFaviconForBookmark(urls[idx], alive, {
        externalFaviconProviders: settings.enableExternalFaviconProviders,
      });
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(PREFETCH_CONCURRENCY, Math.max(1, urls.length)) },
      () => worker(),
    ),
  );
}

function detachVisibilityResume(): void {
  if (!visibilityListenerAttached || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibilityListenerAttached = false;
}

function onVisibilityChange(): void {
  if (document.hidden) return;
  const alive = () =>
    typeof document !== "undefined" && !document.hidden;
  enqueuePrefetchPass(alive);
}

function attachVisibilityResume(): void {
  if (visibilityListenerAttached || typeof document === "undefined") return;
  visibilityListenerAttached = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function maybeDetachVisibilityResume(): void {
  const done =
    !prefetchSlice ||
    prefetchSlice.next >= prefetchSlice.urls.length;
  if (done) detachVisibilityResume();
}

function enqueuePrefetchPass(alive: () => boolean): void {
  prefetchChain = prefetchChain
    .then(() => runPrefetchPassWork(alive))
    .catch(() => {
      /* bookmarks API / resolve errors — slice kept for visibility retry */
    });
}

async function runPrefetchPassWork(alive: () => boolean): Promise<void> {
  attachVisibilityResume();

  if (!prefetchSlice) {
    try {
      const tree = await browser.bookmarks.getSubTree(bookmarkTreeRootId());
      const urls = collectHttpUrls(tree[0]?.children);
      if (urls.length === 0) {
        maybeDetachVisibilityResume();
        return;
      }
      prefetchSlice = { urls, next: 0 };
    } catch {
      /* keep visibility listener so a later tab focus can retry getSubTree */
      return;
    }
  }

  if (!prefetchSlice) return;

  if (!alive()) return;

  await runPool(prefetchSlice, alive);

  if (prefetchSlice && prefetchSlice.next >= prefetchSlice.urls.length) {
    prefetchSlice = null;
  }
  maybeDetachVisibilityResume();
}

/**
 * After first paint, walks the whole bookmark tree (idle) and warms the favicon
 * IDB cache. Skips demo builds. Uses {@link document.hidden} so work pauses in
 * background tabs; resumes on {@link document.visibilitychange} when visible again.
 */
export function startFaviconPrefetchOnce(): void {
  if (prefetchScheduled) return;
  prefetchScheduled = true;
  if (typeof __DEMO__ !== "undefined" && __DEMO__) return;

  const alive = () =>
    typeof document !== "undefined" && !document.hidden;

  const kick = () => {
    enqueuePrefetchPass(alive);
  };

  const schedule = () => {
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === "function") {
      ric(kick, { timeout: 20_000 });
    } else {
      setTimeout(kick, 1500);
    }
  };

  if (typeof document === "undefined") {
    schedule();
    return;
  }
  if (document.readyState === "complete") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }
}
