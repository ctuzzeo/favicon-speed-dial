import browser from "webextension-polyfill";

type FetchBingWallpaperMessage = { type: "FETCH_BING_WALLPAPER" };

browser.runtime.onMessage.addListener(async (message: FetchBingWallpaperMessage | unknown) => {
  if (message && typeof message === "object" && "type" in message && message.type === "FETCH_BING_WALLPAPER") {
    try {
      const response = await fetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1");
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
});
