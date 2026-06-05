import { contrastRatio } from "random-color-library";

import { getImageAverageColor } from "#lib/imageLuminance";

/**
 * Whether the page's current <html> background is dark, measured from the resolved
 * background — image URL (built-in / custom / Bing wallpapers) or solid colour. Drives
 * the "Automatic" text colour scheme and the settings-gear icon colour, so both adapt
 * to the wallpaper rather than the OS theme.
 *
 * Falls back to the background colour if the image can't be measured (e.g. a tainted
 * cross-origin canvas).
 */
export async function getBackgroundIsDark(): Promise<boolean> {
  const style = window.getComputedStyle(document.documentElement);
  const imageUrl = style.backgroundImage.match(
    /url\(['"]?([^'"]*?)['"]?\)/,
  )?.[1];
  if (imageUrl) {
    try {
      return (await getImageAverageColor(imageUrl)) < 0.5;
    } catch {
      /* fall back to the background colour */
    }
  }
  const bgColor = style.backgroundColor;
  return contrastRatio(bgColor, "#ffffff") > contrastRatio(bgColor, "#000000");
}
