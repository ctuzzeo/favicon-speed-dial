import bookmarksApi from "#stores/useBookmarks/mockBookmarks/browser.bookmarks";
import settingsApi from "#stores/useSettings/browser-polyfill";

/** Demo / `npm run build`: merged mocks for `webextension-polyfill`. */
export default {
  ...bookmarksApi,
  ...settingsApi,
  runtime: {
    sendMessage: async (): Promise<{ success: false }> =>
      Promise.resolve({ success: false }),
  },
};
