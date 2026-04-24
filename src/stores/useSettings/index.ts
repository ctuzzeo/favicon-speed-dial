import { clsx } from "clsx/lite";
import { autorun, makeAutoObservable, remove, runInAction, set } from "mobx";
import semverCoerce from "semver/functions/coerce";
import semverGt from "semver/functions/gt";
import browser from "webextension-polyfill";

import {
  assertBingCdnHttpsUrl,
  buildBingWallpaperUrlFromHpApiPath,
} from "#lib/bingWallpaperUrl";

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

function getColorScheme(value: string) {
  return (value === "System Theme" && prefersDarkMode()) || value === "Dark"
    ? "color-scheme-dark"
    : "color-scheme-light";
}

const bc = new BroadcastChannel("favicon-speed-dial-settings");

type StorageSnapshot = Record<string, unknown>;

type BingWallpaperMessageResponse =
  | { success: true; data: { images: Array<{ url?: string }> } }
  | { success: false; error?: string };

function readStorageString(snapshot: StorageSnapshot, key: string, fallback: string) {
  const v = snapshot[key];
  return typeof v === "string" ? v : fallback;
}

function readStorageStringOrFallback(snapshot: StorageSnapshot, key: string, fallback: string) {
  const v = readStorageString(snapshot, key, "");
  return v || fallback;
}

function readStorageBoolean(snapshot: StorageSnapshot, key: string, fallback: boolean) {
  const v = snapshot[key];
  return typeof v === "boolean" ? v : fallback;
}

function readStorageNumberOr(snapshot: StorageSnapshot, key: string, fallback: number) {
  const v = snapshot[key];
  return typeof v === "number" && !Number.isNaN(v) ? v || fallback : fallback;
}

function readStorageNumber(snapshot: StorageSnapshot, key: string, fallback: number) {
  const v = snapshot[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

function readStorageRecord<T extends Record<string, unknown>>(snapshot: StorageSnapshot, key: string, fallback: T): T {
  const v = snapshot[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
}

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
  manualFavicons: {} as ManualFavicons,
  dialSize: "small",
  dialTransparent: {} as Record<string, boolean>,
  firstRun: true,
  maxColumns: "7",
  newTab: true,
  showAlertBanner: true,
  squareDials: true,
  enableSync: true,
  columnGap: 28,
  rowGap: 28,
  titleOpacity: 0.75,
  titleSize: 13,
  themeOption: "System Theme",
  wallpaper: prefersDarkMode() ? "dark-wallpaper" : "light-wallpaper",
  bingWallpaperUrl: "",
  bingDebugInfo: "",
  /** Show a bar to jump between top-level bookmark locations (toolbar, other bookmarks, etc.). */
  showBookmarkSectionBar: true,
  /** Restore the last-opened folder on new tab (localStorage); URL hash still wins when set. */
  rememberLastFolder: true,
  /**
   * When true, third-party favicon services may be used (they learn bookmark hostnames).
   * When false, only same-origin assets, web manifests, and Chrome’s built-in `/_favicon/`.
   */
  enableExternalFaviconProviders: true,
};

export const settings = makeAutoObservable({
  ...defaultSettings,
  isLoaded: false,

  async initialize() {
    try {
      const localStorage = (await browser.storage.local.get()) as StorageSnapshot;
      const syncStorage = (await (browser.storage.sync
        ? browser.storage.sync.get()
        : Promise.resolve({}))) as StorageSnapshot;

      const storage: StorageSnapshot = { ...localStorage, ...syncStorage };
      const lastVersion =
        semverCoerce(readStorageString(storage, "last-version", ""))?.version || false;
      const isUpgrade = lastVersion && semverGt(appVersion, lastVersion);
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
        settings.manualFavicons = readStorageRecord<ManualFavicons>(
          storage,
          `${apiVersion}-manual-favicons`,
          defaultSettings.manualFavicons,
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
        settings.newTab = readStorageBoolean(storage, `${apiVersion}-new-tab`, defaultSettings.newTab);
        settings.enableSync = readStorageBoolean(
          storage,
          `${apiVersion}-enable-sync`,
          defaultSettings.enableSync,
        );
        settings.columnGap = readStorageNumberOr(storage, `${apiVersion}-column-gap`, defaultSettings.columnGap);
        settings.rowGap = readStorageNumberOr(storage, `${apiVersion}-row-gap`, defaultSettings.rowGap);
        settings.titleOpacity = readStorageNumber(
          storage,
          `${apiVersion}-title-opacity`,
          defaultSettings.titleOpacity,
        );
        settings.titleSize = readStorageNumber(storage, `${apiVersion}-title-size`, defaultSettings.titleSize);
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
        settings.bingDebugInfo = settings.bingWallpaperUrl ? "Loaded from cache" : "No image yet";
        settings.squareDials = readStorageBoolean(
          storage,
          `${apiVersion}-square-dials`,
          defaultSettings.squareDials,
        );
        settings.showBookmarkSectionBar = readStorageBoolean(
          storage,
          `${apiVersion}-bookmark-section-bar`,
          defaultSettings.showBookmarkSectionBar,
        );
        settings.rememberLastFolder = readStorageBoolean(
          storage,
          `${apiVersion}-remember-last-folder`,
          defaultSettings.rememberLastFolder,
        );
        settings.enableExternalFaviconProviders = readStorageBoolean(
          storage,
          `${apiVersion}-external-favicon-providers`,
          defaultSettings.enableExternalFaviconProviders,
        );
        settings.dialTransparent = readStorageRecord<Record<string, boolean>>(
          storage,
          `${apiVersion}-dial-transparent`,
          defaultSettings.dialTransparent,
        );
        settings.colorScheme = getColorScheme(settings.themeOption);
        settings.firstRun = !lastVersion;
        settings.showAlertBanner = Boolean(!lastVersion || isUpgrade);
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

      // Fetch Bing if active
      if (settings.wallpaper === "bing-wallpaper") {
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
      browser.storage.sync.set({ [storageKey]: value }).catch(err => {
        console.warn("Sync failed (possibly quota exceeded):", err);
      });
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
            settings._saveSetting("custom-image", base64);
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

  handleClearThumbnail(id: string) {
    if (settings.dialImages[id]) {
      runInAction(() => {
        delete settings.dialImages[id];
      });
      settings._saveSetting("dial-images", { ...settings.dialImages });
      bc.postMessage({ dialImages: { ...settings.dialImages } });
    }
  },

  handleManualFavicon(hostname: string, url: string) {
    runInAction(() => {
      set(settings.manualFavicons, hostname, url);
    });
    settings._saveSetting("manual-favicons", { ...settings.manualFavicons });
    bc.postMessage({ manualFavicons: { ...settings.manualFavicons } });
  },

  handleClearManualFavicon(hostname: string) {
    if (settings.manualFavicons[hostname]) {
      runInAction(() => {
        remove(settings.manualFavicons, hostname);
      });
      settings._saveSetting("manual-favicons", { ...settings.manualFavicons });
      bc.postMessage({ manualFavicons: { ...settings.manualFavicons } });
    }
  },

  async handleSelectThumbnail(id: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          runInAction(() => {
            set(settings.dialImages, id, base64);
          });
          settings._saveSetting("dial-images", { ...settings.dialImages });
          bc.postMessage({ dialImages: { ...settings.dialImages } });
        };
        reader.readAsDataURL(file);
      }
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
            await browser.storage.local.clear();
            await browser.storage.local.set(data);
            location.reload();
          } catch (err) {
            console.error("Failed to restore from JSON", err);
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
      runInAction(() => { settings.bingDebugInfo = "Requesting image via Background Service..."; });
      
      const response = (await browser.runtime.sendMessage({
        type: "FETCH_BING_WALLPAPER",
      })) as BingWallpaperMessageResponse | undefined | null;

      if (!response || !response.success) {
        throw new Error(
          response && "error" in response ? response.error : "Failed to communicate with Background Service",
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

  hideAlertBanner() {
    runInAction(() => {
      settings.showAlertBanner = false;
    });
  },

  handleSquareDials(value: boolean) {
    settings.squareDials = value;
    settings._saveSetting("square-dials", value);
    bc.postMessage({ squareDials: value });
  },

  handleShowBookmarkSectionBar(value: boolean) {
    settings.showBookmarkSectionBar = value;
    settings._saveSetting("bookmark-section-bar", value);
    bc.postMessage({ showBookmarkSectionBar: value });
  },

  handleRememberLastFolder(value: boolean) {
    settings.rememberLastFolder = value;
    settings._saveSetting("remember-last-folder", value);
    bc.postMessage({ rememberLastFolder: value });
  },

  handleExternalFaviconProviders(value: boolean) {
    settings.enableExternalFaviconProviders = value;
    settings._saveSetting("external-favicon-providers", value);
    bc.postMessage({ enableExternalFaviconProviders: value });
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
  } else if (settings.wallpaper === "bing-wallpaper" && settings.bingWallpaperUrl) {
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

// Initialize on load
settings.initialize();

// Listen for sync changes
if (browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      runInAction(() => {
        for (const [key, { newValue }] of Object.entries(changes)) {
          const settingKey = key.replace(`${apiVersion}-`, "").replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          if (settingKey in settings) {
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
