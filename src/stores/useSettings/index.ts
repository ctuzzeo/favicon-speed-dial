import { clsx } from "clsx/lite";
import {
  autorun,
  makeAutoObservable,
  reaction,
  remove,
  runInAction,
  set,
} from "mobx";
import browser from "webextension-polyfill";

import {
  assertBingCdnHttpsUrl,
  buildBingWallpaperUrlFromHpApiPath,
} from "#lib/bingWallpaperUrl";
import { getBackgroundIsDark } from "#lib/backgroundLuminance";
import { compressImageToDataUrl } from "#lib/imageCompress";
import {
  readStorageBoolean,
  readStorageNumber,
  readStorageRecord,
  readStorageString,
  readStorageStringOrFallback,
  type StorageSnapshot,
} from "#lib/storageReaders";
import {
  collectPerSiteEntries,
  EXTERNAL_HOST_INFIX,
  hostnameForSiteKey,
  MANUAL_FAVICON_INFIX,
  mergeLegacyAndPerSite,
  parsePerSiteKey,
  perSiteKey,
  SITE_COLOR_INFIX,
  SITE_IMAGE_INFIX,
  SITE_TRANSPARENT_INFIX,
} from "#lib/syncKeys";

// ==================================================================
// SETUP
// ==================================================================

const appVersion = __APP_VERSION__;
const apiVersion = "2.0";

// Helper to convert base64 to Blob (used for custom images)
function base64ToBlob(base64: string) {
  const contentType = base64.match(/data:([^;]+);base64,/)?.[1];
  if (!contentType) throw new Error("Invalid base64 format");
  const base64Data = base64.replace(/data:([^;]+);base64,/, "");
  const binaryData = atob(base64Data);
  const length = binaryData.length;
  const uint8Array = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    uint8Array[i] = binaryData.charCodeAt(i);
  }

  return new Blob([uint8Array], { type: contentType });
}

function prefersDarkMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Local date as YYYY-MM-DD, used to fetch the Bing wallpaper at most once/day. */
function todayDateString() {
  return new Date().toISOString().split("T")[0];
}

function getColorScheme(value: string) {
  if (value === "Dark") return "color-scheme-dark";
  if (value === "Light") return "color-scheme-light";
  // "System Theme" is the "Automatic" option: refined from the wallpaper's brightness
  // by the luminance reaction below. This is just the provisional value until then.
  return prefersDarkMode() ? "color-scheme-dark" : "color-scheme-light";
}

const bc = new BroadcastChannel("favicon-speed-dial-settings");

type BingWallpaperMessageResponse =
  | { success: true; data: { images: Array<{ url?: string }> } }
  | { success: false; error?: string };

const syncedStorageKeyToSettingKey: Record<
  string,
  keyof typeof defaultSettings
> = {};

// ==================================================================
// SETTINGS STORE
// ==================================================================

type DialColors = Record<string, string>;
type DialImages = Record<string, string>;
type ManualFavicons = Record<string, string>;

const defaultSettings = {
  colorScheme: prefersDarkMode() ? "color-scheme-dark" : "color-scheme-light",
  customColor: "",
  customImage: "",
  defaultFolder: "",
  dialColors: {} as DialColors,
  dialImages: {} as DialImages,
  siteImages: {} as DialImages,
  manualFavicons: {} as ManualFavicons,
  dialSize: "small",
  dialTransparent: {} as Record<string, boolean>,
  /**
   * Per-site (hostname) background colour (hex) and transparency ("1"/"0"). Synced
   * per-site like siteImages so a colour/transparency edit applies to every bookmark of
   * that domain. Legacy by-id dialColors/dialTransparent remain as a read fallback.
   */
  siteColors: {} as Record<string, string>,
  siteTransparent: {} as Record<string, string>,
  maxColumns: "7",
  newTab: true,
  squareDials: true,
  enableSync: true,
  columnGap: 28,
  rowGap: 28,
  titleOpacity: 0.75,
  titleSize: 13,
  themeOption: "System Theme",
  wallpaper: "DesertDay",
  bingWallpaperUrl: "",
  bingDebugInfo: "",
  /** Restore the last-opened folder on new tab (localStorage); URL hash still wins when set. */
  rememberLastFolder: true,
  /**
   * Hostnames the user opted into third-party favicon providers for (Google, etc.).
   * Present ⇒ allowed; absent ⇒ first-party only. Synced per-site like manualFavicons.
   */
  externalProviderHosts: {} as Record<string, string>,
};

export const settings = makeAutoObservable({
  ...defaultSettings,
  isLoaded: false,

  async initialize() {
    try {
      const localStorage =
        (await browser.storage.local.get()) as StorageSnapshot;
      const localSyncEnabled = readStorageBoolean(
        localStorage,
        `${apiVersion}-enable-sync`,
        defaultSettings.enableSync,
      );
      const syncStorage = (await (localSyncEnabled && browser.storage.sync
        ? browser.storage.sync.get()
        : Promise.resolve({}))) as StorageSnapshot;

      const storage: StorageSnapshot = { ...localStorage, ...syncStorage };
      // Record the current version for backup recognition and possible future
      // upgrade detection. Nothing reads it back at runtime today.
      browser.storage.local.set({ "last-version": appVersion });

      runInAction(() => {
        settings.customColor = readStorageStringOrFallback(
          storage,
          `${apiVersion}-custom-color`,
          defaultSettings.customColor,
        );
        settings.defaultFolder = readStorageStringOrFallback(
          storage,
          `${apiVersion}-default-folder`,
          defaultSettings.defaultFolder,
        );
        settings.dialColors = readStorageRecord<DialColors>(
          storage,
          `${apiVersion}-dial-colors`,
          defaultSettings.dialColors,
        );
        settings.dialImages = readStorageRecord<DialImages>(
          storage,
          `${apiVersion}-dial-images`,
          defaultSettings.dialImages,
        );
        settings.manualFavicons = mergeLegacyAndPerSite(
          readStorageRecord<ManualFavicons>(
            storage,
            `${apiVersion}-manual-favicons`,
            defaultSettings.manualFavicons,
          ),
          collectPerSiteEntries(storage, apiVersion, MANUAL_FAVICON_INFIX),
        );
        settings.siteImages = collectPerSiteEntries(
          storage,
          apiVersion,
          SITE_IMAGE_INFIX,
        );
        settings.siteColors = collectPerSiteEntries(
          storage,
          apiVersion,
          SITE_COLOR_INFIX,
        );
        settings.siteTransparent = collectPerSiteEntries(
          storage,
          apiVersion,
          SITE_TRANSPARENT_INFIX,
        );
        settings.dialSize = readStorageStringOrFallback(
          storage,
          `${apiVersion}-dial-size`,
          defaultSettings.dialSize,
        );
        settings.maxColumns = readStorageStringOrFallback(
          storage,
          `${apiVersion}-max-columns`,
          defaultSettings.maxColumns,
        );
        settings.newTab = readStorageBoolean(
          storage,
          `${apiVersion}-new-tab`,
          defaultSettings.newTab,
        );
        settings.enableSync = readStorageBoolean(
          localStorage,
          `${apiVersion}-enable-sync`,
          defaultSettings.enableSync,
        );
        settings.columnGap = readStorageNumber(
          storage,
          `${apiVersion}-column-gap`,
          defaultSettings.columnGap,
        );
        settings.rowGap = readStorageNumber(
          storage,
          `${apiVersion}-row-gap`,
          defaultSettings.rowGap,
        );
        settings.titleOpacity = readStorageNumber(
          storage,
          `${apiVersion}-title-opacity`,
          defaultSettings.titleOpacity,
        );
        settings.titleSize = readStorageNumber(
          storage,
          `${apiVersion}-title-size`,
          defaultSettings.titleSize,
        );
        settings.themeOption = readStorageStringOrFallback(
          storage,
          `${apiVersion}-theme-option`,
          defaultSettings.themeOption,
        );
        settings.wallpaper = readStorageStringOrFallback(
          storage,
          `${apiVersion}-wallpaper`,
          defaultSettings.wallpaper,
        );
        settings.bingWallpaperUrl = readStorageStringOrFallback(
          storage,
          `${apiVersion}-bing-wallpaper-url`,
          "",
        );
        settings.bingDebugInfo = settings.bingWallpaperUrl
          ? "Loaded from cache"
          : "No image yet";
        settings.squareDials = readStorageBoolean(
          storage,
          `${apiVersion}-square-dials`,
          defaultSettings.squareDials,
        );
        settings.rememberLastFolder = readStorageBoolean(
          storage,
          `${apiVersion}-remember-last-folder`,
          defaultSettings.rememberLastFolder,
        );
        settings.externalProviderHosts = collectPerSiteEntries(
          storage,
          apiVersion,
          EXTERNAL_HOST_INFIX,
        );
        settings.dialTransparent = readStorageRecord<Record<string, boolean>>(
          storage,
          `${apiVersion}-dial-transparent`,
          defaultSettings.dialTransparent,
        );
        settings.colorScheme = getColorScheme(settings.themeOption);
        settings.isLoaded = true;
      });

      // Load custom image URL
      const customImageData = storage[`${apiVersion}-custom-image`];
      if (typeof customImageData === "string" && customImageData) {
        try {
          const blobImage = base64ToBlob(customImageData);
          runInAction(() => {
            settings.customImage = URL.createObjectURL(blobImage);
          });
        } catch (e) {
          console.error("Failed to load custom image blob", e);
        }
      }

      // One-time migration: split the legacy single manual-favicons blob into
      // per-site keys (each well under the sync quota), then drop the blob so a
      // cleared favicon can't reappear from a stale blob entry.
      const legacyManual = readStorageRecord<ManualFavicons>(
        storage,
        `${apiVersion}-manual-favicons`,
        {},
      );
      if (Object.keys(legacyManual).length > 0) {
        const existing = collectPerSiteEntries(
          storage,
          apiVersion,
          MANUAL_FAVICON_INFIX,
        );
        const writes: Record<string, string> = {};
        for (const [host, url] of Object.entries(legacyManual)) {
          if (!(host in existing) && typeof url === "string") {
            writes[perSiteKey(apiVersion, MANUAL_FAVICON_INFIX, host)] = url;
          }
        }
        if (Object.keys(writes).length > 0) {
          browser.storage.local.set(writes);
          if (settings.enableSync && browser.storage.sync) {
            browser.storage.sync
              .set(writes)
              .catch((err) =>
                console.warn("Favicon migration sync failed:", err),
              );
          }
        }
        browser.storage.local.remove(`${apiVersion}-manual-favicons`);
        browser.storage.sync
          ?.remove(`${apiVersion}-manual-favicons`)
          .catch(() => {});
      }

      // Fetch Bing only when stale. Bing updates once/day and the cached URL is
      // already applied above, so skip the network call when today's image is
      // cached. An explicit click on "Bing Image" always refetches.
      const cachedBingDate = readStorageString(
        storage,
        `${apiVersion}-bing-wallpaper-date`,
        "",
      );
      if (
        settings.wallpaper === "bing-wallpaper" &&
        (!settings.bingWallpaperUrl || cachedBingDate !== todayDateString())
      ) {
        settings.fetchBingWallpaper();
      }
    } catch (error) {
      console.error("Initialization failed", error);
      runInAction(() => {
        settings.isLoaded = true;
      });
    }
  },

  _saveSetting(key: string, value: unknown, sync = true) {
    const storageKey = `${apiVersion}-${key}`;
    browser.storage.local.set({ [storageKey]: value });
    if (sync && settings.enableSync && browser.storage.sync) {
      browser.storage.sync.set({ [storageKey]: value }).catch((err) => {
        console.warn("Sync failed (possibly quota exceeded):", err);
      });
    }
  },

  /** Save one per-site entry (favicon URL / compressed image) under its own key. */
  _savePerSite(infix: string, host: string, value: string) {
    const key = perSiteKey(apiVersion, infix, host);
    browser.storage.local.set({ [key]: value });
    if (settings.enableSync && browser.storage.sync) {
      browser.storage.sync.set({ [key]: value }).catch((err) => {
        console.warn("Sync failed (possibly quota exceeded):", err);
      });
    }
  },

  _removePerSite(infix: string, host: string) {
    const key = perSiteKey(apiVersion, infix, host);
    browser.storage.local.remove(key);
    if (browser.storage.sync) {
      browser.storage.sync.remove(key).catch(() => {});
    }
  },

  handleCustomColor(value: string) {
    settings.customColor = value;
    settings._saveSetting("custom-color", value);
    settings.handleWallpaper("custom-color");
    bc.postMessage({ customColor: value });
  },

  handleDefaultFolder(value: string) {
    runInAction(() => {
      settings.defaultFolder = value;
    });
    settings._saveSetting("default-folder", value);
    bc.postMessage({ defaultFolder: value });
  },

  async handleCustomImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          try {
            const blobImage = base64ToBlob(base64);
            const blobUrl = URL.createObjectURL(blobImage);
            runInAction(() => {
              settings.customImage = blobUrl;
              settings.wallpaper = "custom-image";
            });
            // custom images are base64 and exceed the storage.sync per-item
            // quota, so keep them local-only (sync=false).
            settings._saveSetting("custom-image", base64, false);
            settings._saveSetting("wallpaper", "custom-image");
            bc.postMessage({ customImage: blobUrl, wallpaper: "custom-image" });
          } catch (err) {
            console.error("Failed to process custom image", err);
          }
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  },

  handleClearColor(id: string) {
    if (settings.dialColors[id]) {
      runInAction(() => {
        delete settings.dialColors[id];
      });
      settings._saveSetting("dial-colors", { ...settings.dialColors });
      bc.postMessage({ dialColors: { ...settings.dialColors } });
    }
  },

  handleDialColors(id: string, color: string) {
    runInAction(() => {
      set(settings.dialColors, id, color);
    });
    settings._saveSetting("dial-colors", { ...settings.dialColors });
    bc.postMessage({ dialColors: { ...settings.dialColors } });
  },

  async handleClearThumbnail(id: string) {
    let bookmarkUrl: string | undefined;
    try {
      bookmarkUrl = (await browser.bookmarks.get(id))[0]?.url;
    } catch {
      /* folder, or already removed */
    }
    const host = bookmarkUrl ? hostnameForSiteKey(bookmarkUrl) : "";
    let changed = false;
    if (host && settings.siteImages[host]) {
      runInAction(() => {
        remove(settings.siteImages, host);
      });
      settings._removePerSite(SITE_IMAGE_INFIX, host);
      changed = true;
    }
    if (settings.dialImages[id]) {
      runInAction(() => {
        delete settings.dialImages[id];
      });
      // Folder thumbnails / legacy entries stay local-only (base64 > sync quota).
      settings._saveSetting("dial-images", { ...settings.dialImages }, false);
      changed = true;
    }
    if (changed) {
      bc.postMessage({
        siteImages: { ...settings.siteImages },
        dialImages: { ...settings.dialImages },
      });
    }
  },

  handleManualFavicon(hostname: string, url: string) {
    runInAction(() => {
      set(settings.manualFavicons, hostname, url);
    });
    settings._savePerSite(MANUAL_FAVICON_INFIX, hostname, url);
    bc.postMessage({ manualFavicons: { ...settings.manualFavicons } });
  },

  handleClearManualFavicon(hostname: string) {
    if (settings.manualFavicons[hostname]) {
      runInAction(() => {
        remove(settings.manualFavicons, hostname);
      });
      settings._removePerSite(MANUAL_FAVICON_INFIX, hostname);
      bc.postMessage({ manualFavicons: { ...settings.manualFavicons } });
    }
  },

  async handleSelectThumbnail(id: string) {
    // Bookmarks key the image by hostname (compressed, synced per-site); folders have
    // no hostname / stable id, so their thumbnails stay device-local by id.
    let bookmarkUrl: string | undefined;
    try {
      bookmarkUrl = (await browser.bookmarks.get(id))[0]?.url;
    } catch {
      /* id is a folder or already gone */
    }
    const host = bookmarkUrl ? hostnameForSiteKey(bookmarkUrl) : "";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        if (host) {
          try {
            const compressed = await compressImageToDataUrl(base64, {
              maxDim: 192,
              maxLen: 7000,
            });
            runInAction(() => {
              set(settings.siteImages, host, compressed);
              // A per-site image supersedes any legacy by-id thumbnail.
              if (settings.dialImages[id]) delete settings.dialImages[id];
            });
            settings._savePerSite(SITE_IMAGE_INFIX, host, compressed);
            settings._saveSetting(
              "dial-images",
              { ...settings.dialImages },
              false,
            );
            bc.postMessage({
              siteImages: { ...settings.siteImages },
              dialImages: { ...settings.dialImages },
            });
          } catch (err) {
            console.error("Failed to compress thumbnail", err);
          }
        } else {
          runInAction(() => {
            set(settings.dialImages, id, base64);
          });
          settings._saveSetting(
            "dial-images",
            { ...settings.dialImages },
            false,
          );
          bc.postMessage({ dialImages: { ...settings.dialImages } });
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  },

  async saveToJSON() {
    const storage = await browser.storage.local.get();
    const data = JSON.stringify(storage, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `favicon-speed-dial-backup-${new Date().toISOString().split("T")[0]}.json`;
    link.click();
  },

  async restoreFromJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const data = JSON.parse(reader.result as string);
            const isPlainObject =
              typeof data === "object" && data !== null && !Array.isArray(data);
            // A real backup is a dump of storage.local, which always contains
            // "last-version" plus our "2.0-" keys. Reject anything else BEFORE
            // clearing, so a malformed file can't wipe the user's settings.
            const looksLikeBackup =
              isPlainObject &&
              Object.keys(data).some(
                (key) =>
                  key === "last-version" || key.startsWith(`${apiVersion}-`),
              );
            if (!looksLikeBackup) {
              throw new Error(
                "This file is not a Favicon Speed Dial backup.",
              );
            }
            await browser.storage.local.clear();
            await browser.storage.local.set(data as Record<string, unknown>);
            location.reload();
          } catch (err) {
            console.error("Failed to restore from JSON", err);
            alert(
              err instanceof Error
                ? `Restore failed: ${err.message}`
                : "Restore failed: the file could not be read.",
            );
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  },

  handleWallpaper(value: string) {
    settings.wallpaper = value;
    settings._saveSetting("wallpaper", value);
    if (value === "bing-wallpaper") {
      settings.fetchBingWallpaper();
    }
    bc.postMessage({ wallpaper: value });
  },

  async fetchBingWallpaper() {
    try {
      runInAction(() => {
        settings.bingDebugInfo = "Requesting image via Background Service...";
      });

      const response = (await browser.runtime.sendMessage({
        type: "FETCH_BING_WALLPAPER",
      })) as BingWallpaperMessageResponse | undefined | null;

      if (!response || !response.success) {
        throw new Error(
          response && "error" in response
            ? response.error
            : "Failed to communicate with Background Service",
        );
      }

      const image = response.data.images[0];
      if (!image || !image.url) {
        throw new Error("Invalid response from Bing (no image URL)");
      }

      let imageUrl = buildBingWallpaperUrlFromHpApiPath(image.url);
      if (!imageUrl) {
        throw new Error("Invalid Bing image URL (rejected by allowlist)");
      }
      if (imageUrl.includes("1366x768")) {
        imageUrl = imageUrl.replace("1366x768", "1920x1080");
      }
      const validated = assertBingCdnHttpsUrl(imageUrl);
      if (!validated) {
        throw new Error("Invalid Bing image URL after normalization");
      }
      imageUrl = validated;

      runInAction(() => {
        settings.bingWallpaperUrl = imageUrl;
        settings.bingDebugInfo = `Success! Image retrieved via Background.`;
        settings._saveSetting("bing-wallpaper-url", imageUrl, false);
        settings._saveSetting("bing-wallpaper-date", todayDateString(), false);
      });
    } catch (error) {
      console.error("Error fetching Bing wallpaper:", error);
      runInAction(() => {
        settings.bingDebugInfo = `Background Error: ${error instanceof Error ? error.message : String(error)}`;
      });
    }
  },

  handleDialSize(value: string) {
    settings.dialSize = value;
    settings._saveSetting("dial-size", value);
    bc.postMessage({ dialSize: value });
  },

  handleMaxColumns(value: string) {
    settings.maxColumns = value;
    settings._saveSetting("max-columns", value);
    bc.postMessage({ maxColumns: value });
  },

  handleNewTab(value: boolean) {
    settings.newTab = value;
    settings._saveSetting("new-tab", value);
    bc.postMessage({ newTab: value });
  },

  handleEnableSync(value: boolean) {
    settings.enableSync = value;
    browser.storage.local.set({ [`${apiVersion}-enable-sync`]: value });
    bc.postMessage({ enableSync: value });
  },

  handleColumnGap(value: number) {
    settings.columnGap = value;
    settings._saveSetting("column-gap", value);
    bc.postMessage({ columnGap: value });
  },

  handleRowGap(value: number) {
    settings.rowGap = value;
    settings._saveSetting("row-gap", value);
    bc.postMessage({ rowGap: value });
  },

  handleTitleOpacity(value: number) {
    settings.titleOpacity = value;
    settings._saveSetting("title-opacity", value);
    bc.postMessage({ titleOpacity: value });
  },

  handleTitleSize(value: number) {
    settings.titleSize = value;
    settings._saveSetting("title-size", value);
    bc.postMessage({ titleSize: value });
  },

  handleSquareDials(value: boolean) {
    settings.squareDials = value;
    settings._saveSetting("square-dials", value);
    bc.postMessage({ squareDials: value });
  },

  handleRememberLastFolder(value: boolean) {
    settings.rememberLastFolder = value;
    settings._saveSetting("remember-last-folder", value);
    bc.postMessage({ rememberLastFolder: value });
  },

  externalAllowedForUrl(url: string | undefined): boolean {
    if (!url) return false;
    return Boolean(settings.externalProviderHosts[hostnameForSiteKey(url)]);
  },

  handleExternalForHost(hostname: string, allowed: boolean) {
    if (!hostname) return;
    if (allowed) {
      runInAction(() => set(settings.externalProviderHosts, hostname, "1"));
      settings._savePerSite(EXTERNAL_HOST_INFIX, hostname, "1");
    } else {
      runInAction(() => remove(settings.externalProviderHosts, hostname));
      settings._removePerSite(EXTERNAL_HOST_INFIX, hostname);
    }
    bc.postMessage({
      externalProviderHosts: { ...settings.externalProviderHosts },
    });
  },

  /** Per-site (hostname) background colour — applies to every bookmark of that domain. */
  handleSiteColor(host: string, color: string) {
    if (!host) return;
    runInAction(() => set(settings.siteColors, host, color));
    settings._savePerSite(SITE_COLOR_INFIX, host, color);
    bc.postMessage({ siteColors: { ...settings.siteColors } });
  },

  handleClearSiteColor(host: string) {
    if (!host || !settings.siteColors[host]) return;
    runInAction(() => remove(settings.siteColors, host));
    settings._removePerSite(SITE_COLOR_INFIX, host);
    bc.postMessage({ siteColors: { ...settings.siteColors } });
  },

  /** Per-site (hostname) transparency — applies to every bookmark of that domain. */
  handleSiteTransparent(host: string, value: boolean) {
    if (!host) return;
    const raw = value ? "1" : "0";
    runInAction(() => set(settings.siteTransparent, host, raw));
    settings._savePerSite(SITE_TRANSPARENT_INFIX, host, raw);
    bc.postMessage({ siteTransparent: { ...settings.siteTransparent } });
  },

  handleDialTransparent(id: string, value: boolean) {
    runInAction(() => {
      set(settings.dialTransparent, id, value);
    });
    settings._saveSetting("dial-transparent", { ...settings.dialTransparent });
    bc.postMessage({ dialTransparent: { ...settings.dialTransparent } });
  },

  handleThemeOption(value: string) {
    settings.themeOption = value;
    settings.colorScheme = getColorScheme(value);
    settings._saveSetting("theme-option", value);
    bc.postMessage({ themeOption: value, colorScheme: settings.colorScheme });
  },

  async resetSettings() {
    await browser.storage.local.clear();
    if (browser.storage.sync) await browser.storage.sync.clear();
    location.reload();
  },
});

const userAgent = navigator.userAgent.toLowerCase();
const isMacOS = userAgent.includes("macintosh");
const isChrome = userAgent.includes("chrome");

// Setup autorun BEFORE initialization
autorun(() => {
  // Don't paint theme/wallpaper from default settings before storage has been
  // read; doing so caused a visible flash on cold boot (default wallpaper →
  // real wallpaper). index.html shows a neutral background until isLoaded.
  if (!settings.isLoaded) return;
  const root = document.documentElement;
  root.className = clsx(
    settings.colorScheme as string,
    settings.wallpaper as string,
    "Wallpapers",
    isChrome ? "chrome" : "firefox",
    isMacOS ? "mac" : "windows",
    "show-title",
    "normal-title",
    settings.dialSize,
    settings.maxColumns === "Unlimited" ? "unlimited-columns" : undefined,
    settings.squareDials ? "square" : "round",
  );

  // Use removeProperty to allow CSS classes to take over for presets
  if (settings.wallpaper === "custom-image" && settings.customImage) {
    root.style.backgroundImage = `url(${settings.customImage})`;
  } else if (
    settings.wallpaper === "bing-wallpaper" &&
    settings.bingWallpaperUrl
  ) {
    root.style.backgroundImage = `url(${settings.bingWallpaperUrl})`;
  } else {
    root.style.removeProperty("background-image");
  }

  if (settings.wallpaper === "custom-color" && settings.customColor) {
    root.style.backgroundColor = settings.customColor;
    root.style.setProperty("--background-color", settings.customColor);
  } else {
    root.style.removeProperty("background-color");
    root.style.removeProperty("--background-color");
  }
});

// "Automatic" color scheme: derive light/dark text from the wallpaper's brightness
// (dark background → light text). Registered after the wallpaper autorun so the
// background is applied first; the async measure is guarded with a generation counter.
let autoSchemeGen = 0;
reaction(
  () => ({
    isLoaded: settings.isLoaded,
    themeOption: settings.themeOption,
    wallpaper: settings.wallpaper,
    customImage: settings.customImage,
    customColor: settings.customColor,
    bingWallpaperUrl: settings.bingWallpaperUrl,
  }),
  ({ isLoaded, themeOption }) => {
    if (!isLoaded || themeOption !== "System Theme") return;
    const gen = ++autoSchemeGen;
    getBackgroundIsDark()
      .then((isDark) => {
        if (gen !== autoSchemeGen) return;
        runInAction(() => {
          settings.colorScheme = isDark
            ? "color-scheme-dark"
            : "color-scheme-light";
        });
      })
      .catch(() => {});
  },
  { fireImmediately: true },
);

// Initialize on load
settings.initialize();

// Listen for sync changes
if (browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && settings.enableSync) {
      runInAction(() => {
        for (const [key, { newValue }] of Object.entries(changes)) {
          // Per-site manual favicon keys (one hostname each).
          const favHost = parsePerSiteKey(
            apiVersion,
            MANUAL_FAVICON_INFIX,
            key,
          );
          if (favHost) {
            if (typeof newValue === "string") {
              set(settings.manualFavicons, favHost, newValue);
            } else {
              remove(settings.manualFavicons, favHost);
            }
            continue;
          }
          // Per-site image keys (one hostname each).
          const imgHost = parsePerSiteKey(apiVersion, SITE_IMAGE_INFIX, key);
          if (imgHost) {
            if (typeof newValue === "string") {
              set(settings.siteImages, imgHost, newValue);
            } else {
              remove(settings.siteImages, imgHost);
            }
            continue;
          }
          // Per-site third-party-provider opt-in keys.
          const extHost = parsePerSiteKey(apiVersion, EXTERNAL_HOST_INFIX, key);
          if (extHost) {
            if (typeof newValue === "string") {
              set(settings.externalProviderHosts, extHost, newValue);
            } else {
              remove(settings.externalProviderHosts, extHost);
            }
            continue;
          }
          // Per-site background colour keys.
          const colorHost = parsePerSiteKey(apiVersion, SITE_COLOR_INFIX, key);
          if (colorHost) {
            if (typeof newValue === "string") {
              set(settings.siteColors, colorHost, newValue);
            } else {
              remove(settings.siteColors, colorHost);
            }
            continue;
          }
          // Per-site transparency keys.
          const transHost = parsePerSiteKey(
            apiVersion,
            SITE_TRANSPARENT_INFIX,
            key,
          );
          if (transHost) {
            if (typeof newValue === "string") {
              set(settings.siteTransparent, transHost, newValue);
            } else {
              remove(settings.siteTransparent, transHost);
            }
            continue;
          }
          const storageKey = key.replace(`${apiVersion}-`, "");
          const settingKey =
            syncedStorageKeyToSettingKey[storageKey] ??
            storageKey.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          // Skip removals (newValue === undefined): a deleted key must not clobber a
          // settings object with undefined. Dropping the legacy manual-favicons blob
          // during migration would otherwise set manualFavicons = undefined and crash
          // the dial's `settings.manualFavicons[host]` lookups.
          if (settingKey in settings && newValue !== undefined) {
            set(
              settings,
              settingKey as keyof typeof settings,
              newValue as (typeof settings)[keyof typeof settings],
            );
          }
        }
      });
    }
  });
}

bc.onmessage = (e) => {
  runInAction(() => set(settings, e.data));
};
