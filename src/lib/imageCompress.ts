/**
 * Downscale + compress an image to a small data URL that fits the storage.sync
 * per-item limit (~8 KB), so per-site custom images can sync across machines. Steps
 * WebP quality down, then dimensions down, until the data-URL string fits `maxLen`.
 *
 * Canvas-bound, so it runs only in the browser (not unit-tested under jsdom).
 */

interface CompressOptions {
  /** Largest edge of the output, in px. */
  maxDim?: number;
  /** Target max data-URL string length (chars ≈ bytes for ASCII data URLs). */
  maxLen?: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Failed to load image for compression"));
    img.src = src;
  });
}

export async function compressImageToDataUrl(
  source: string,
  { maxDim = 192, maxLen = 7000 }: CompressOptions = {},
): Promise<string> {
  const img = await loadImage(source);
  const natural = Math.max(img.naturalWidth, img.naturalHeight) || maxDim;

  let smallest = "";
  for (
    let dim = Math.min(maxDim, Math.max(natural, 48));
    dim >= 48;
    dim = Math.round(dim * 0.75)
  ) {
    const scale = Math.min(1, dim / natural);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.65, 0.5, 0.35]) {
      const url = canvas.toDataURL("image/webp", quality);
      if (!smallest || url.length < smallest.length) smallest = url;
      if (url.length <= maxLen) return url;
    }
  }
  // Best effort: return the smallest produced even if still over the target; the
  // caller stores it locally and the sync write declines gracefully if too big.
  return smallest;
}
