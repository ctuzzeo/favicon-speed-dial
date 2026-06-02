import browser from "webextension-polyfill";

type FetchBingWallpaperMessage = { type: "FETCH_BING_WALLPAPER" };

browser.runtime.onMessage.addListener(
  (message: FetchBingWallpaperMessage | unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "FETCH_BING_WALLPAPER"
    ) {
      return (async () => {
        try {
          const response = await fetch(
            "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1",
          );
          const data = await response.json();
          return { success: true, data };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })();
    }
    // Not our message: return undefined synchronously so we don't hold the
    // response channel open for messages we don't handle.
    return undefined;
  },
);
