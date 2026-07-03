/**
 * Extract the dominant (most prominent, vivid) colour from a favicon — used by the
 * bookmark editor to "match the favicon's colour". Best-effort: returns null on a load
 * failure, an un-readable (tainted) canvas, or an empty/transparent image.
 */

type Bucket = { r: number; g: number; b: number; weight: number };

/** 5-bit quantisation (32 levels/channel) groups near-identical shades into one bucket. */
function bucketKey(r: number, g: number, b: number): string {
  return `${r >> 3}|${g >> 3}|${b >> 3}`;
}

function addToBucket(
  map: Map<string, Bucket>,
  r: number,
  g: number,
  b: number,
  weight: number,
): void {
  const key = bucketKey(r, g, b);
  const cur = map.get(key);
  if (cur) {
    cur.r += r * weight;
    cur.g += g * weight;
    cur.b += b * weight;
    cur.weight += weight;
  } else {
    map.set(key, { r: r * weight, g: g * weight, b: b * weight, weight });
  }
}

function pickHeaviestBucket(map: Map<string, Bucket>): Bucket | null {
  let best: Bucket | null = null;
  for (const bucket of map.values()) {
    if (!best || bucket.weight > best.weight) best = bucket;
  }
  return best;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function bucketToHex(bucket: Bucket): string {
  const r = clampByte(bucket.r / bucket.weight);
  const g = clampByte(bucket.g / bucket.weight);
  const b = clampByte(bucket.b / bucket.weight);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Pick the dominant colour from raw RGBA pixels. A "vivid" pass weights pixels by
 * saturation and skips transparent / near-white / near-black / greyish ones (logo
 * plates and outlines) so the brand colour wins; if there's nothing vivid (mono or
 * greyscale logos), it falls back to the most common opaque colour.
 */
export function dominantColorFromImageData(
  data: Uint8ClampedArray,
): string | null {
  const vivid = new Map<string, Bucket>();
  const opaque = new Map<string, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    addToBucket(opaque, r, g, b, 1);

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    if (max >= 244 && min >= 244) continue; // near-white
    if (max <= 24) continue; // near-black
    if (sat < 28) continue; // greyish
    addToBucket(vivid, r, g, b, sat);
  }

  const best = pickHeaviestBucket(vivid) ?? pickHeaviestBucket(opaque);
  return best && best.weight > 0 ? bucketToHex(best) : null;
}

/** Bounds for the favicon fetch below: an attacker-controlled URL must not be able to
 * hang the page or exhaust memory (no timeout / size cap / MIME check on the old path). */
const ICON_FETCH_TIMEOUT_MS = 12_000;
const ICON_FETCH_MAX_BYTES = 8 * 1024 * 1024;

function loadImageWithTimeout(
  src: string,
  useCors: boolean,
  timeoutMs: number,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      // Detaching the handlers above stops us reacting to this load, but the browser
      // would otherwise keep downloading/decoding it. Clearing src actually aborts it.
      img.src = "";
      reject(new Error("image load timed out"));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image load failed"));
    };
    img.src = src;
  });
}

/**
 * Result of the bounded fetch below. `rejected` means the fetch succeeded but was
 * deliberately declined by a size/type/time policy — the caller must NOT fall back to an
 * unbounded `<img>` load for that, since it would just re-download/decode the same
 * oversized, wrong-type, or too-slow response the cap exists to stop. `network-error`
 * means the fetch failed for an unrelated reason (e.g. an odd CORS block) where a plain
 * `<img>` load might still succeed, so the pre-existing fallback is safe.
 */
export type BoundedFetchResult =
  | { kind: "blob"; blob: Blob }
  | { kind: "rejected" }
  | { kind: "network-error" };

/**
 * Content types that clearly aren't an image and shouldn't be buffered/decoded (a
 * document/markup body, e.g. an error page or an API JSON response). Everything else —
 * `image/*`, an empty/missing type, or a generic binary type like
 * `application/octet-stream` that some CDNs serve `.ico` files with — is allowed through
 * the still-byte-capped stream and simply yields no colour if it doesn't decode.
 */
function isClearlyNotImageContentType(contentType: string): boolean {
  const essence = contentType.split(";")[0].trim().toLowerCase();
  return (
    essence === "text/html" ||
    essence === "application/xhtml+xml" ||
    essence === "application/json" ||
    essence === "application/xml" ||
    essence === "text/xml"
  );
}

/** A fetch/stream that was aborted by our own `AbortSignal.timeout` (too slow). */
function isAbortOrTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Fetch a blob for `url` as a stream capped at `ICON_FETCH_MAX_BYTES`, bailing out (and
 * cancelling the stream) if the response is a clearly-non-image document or the cap is
 * exceeded, or if `alive()` goes false mid-read (e.g. the editor was closed). A timeout
 * counts as a deliberate rejection, not a network error, so the caller doesn't retry the
 * too-slow resource with an unbounded `<img>` load.
 */
export async function fetchImageBlobBounded(
  url: string,
  alive: () => boolean,
): Promise<BoundedFetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: isAbortOrTimeout(err) ? "rejected" : "network-error" };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || isClearlyNotImageContentType(contentType)) {
    return { kind: "rejected" };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (!alive()) {
        await reader.cancel();
        return { kind: "rejected" };
      }
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ICON_FETCH_MAX_BYTES) {
        await reader.cancel();
        return { kind: "rejected" };
      }
      chunks.push(value);
    }
  } catch (err) {
    return { kind: isAbortOrTimeout(err) ? "rejected" : "network-error" };
  }
  return { kind: "blob", blob: new Blob(chunks as BlobPart[], { type: contentType }) };
}

export async function getImageDominantColor(
  url: string,
  alive: () => boolean = () => true,
): Promise<string | null> {
  if (!url) return null;
  let revoke: (() => void) | null = null;
  try {
    let src = url;
    let useCors = true;
    // Fetch as a blob first (the extension has host permissions) so the canvas isn't
    // tainted by a cross-origin favicon; fall back to a CORS <img> load only on a
    // network-level failure — a deliberate size/type rejection must not fall through to
    // an unbounded <img> load, or the cap above is pointless.
    const bounded = await fetchImageBlobBounded(url, alive);
    if (bounded.kind === "rejected") return null;
    if (bounded.kind === "blob") {
      src = URL.createObjectURL(bounded.blob);
      revoke = () => URL.revokeObjectURL(src);
      useCors = false;
    }

    if (!alive()) return null;

    const img = await loadImageWithTimeout(src, useCors, ICON_FETCH_TIMEOUT_MS);

    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    return dominantColorFromImageData(data);
  } catch {
    return null;
  } finally {
    revoke?.();
  }
}
