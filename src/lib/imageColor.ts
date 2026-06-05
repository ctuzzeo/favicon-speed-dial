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

export async function getImageDominantColor(
  url: string,
): Promise<string | null> {
  if (!url) return null;
  let revoke: (() => void) | null = null;
  try {
    let src = url;
    let useCors = true;
    // Fetch as a blob first (the extension has host permissions) so the canvas isn't
    // tainted by a cross-origin favicon; fall back to a CORS <img> load if that fails.
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const blob = await res.blob();
        src = URL.createObjectURL(blob);
        revoke = () => URL.revokeObjectURL(src);
        useCors = false;
      }
    } catch {
      /* fall through to a direct load */
    }

    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });

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
