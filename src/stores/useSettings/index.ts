import { clsx } from "clsx/lite";
import { autorun, makeAutoObservable, remove, runInAction, set } from "mobx";
import semverCoerce from "semver/functions/coerce";
import semverGt from "semver/functions/gt";
import browser from "webextension-polyfill";

import { mockBookmarks } from "#stores/useBookmarks/mockBookmarks";

// ==================================================================
// SETUP
// ==================================================================

const appVersion = __APP_VERSION__;
const apiVersion = "2.0";

async function getCustomImage() {
  try {
    const { [`${apiVersion}-custom-image`]: image } =
      await browser.storage.local.get(`${apiVersion}-custom-image`);
    if (image) {
      const blobImage = base64ToBlob(image as string);
      const imageURI = URL.createObjectURL(blobImage);
      return imageURI;
    } else {
      return "";
    }
  } catch (error) {
    console.error("Error loading custom image:", error);
  }
}

function prefersDarkMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getColorScheme(value: string) {
  return (value === "System Theme" && prefersDarkMode()) || value === "Dark"
    ? "color-scheme-dark"
    : "color-scheme-light";
}

const storage: Record<string, unknown> = await browser.storage.local.get();
const lastVersion =
  semverCoerce(storage["last-version"] as string)?.version || false;
const isUpgrade = lastVersion && semverGt(appVersion, lastVersion);
browser.storage.local.set({ "last-version": appVersion });
const themeOption =
  (storage[`${apiVersion}-theme-option`] as string) || "System Theme";
const colorScheme = getColorScheme(themeOption);
let wallpaper = storage[`${apiVersion}-wallpaper`];

const customImage = await getCustomImage();
wallpaper =
  typeof wallpaper === "string" && wallpaper.includes("custom-image")
    ? "custom-image"
    : (wallpaper as string) ||
      (prefersDarkMode() ? "dark-wallpaper" : "light-wallpaper");

/* Handle changes page between open tabs. */
const bc = new BroadcastChannel("easy-settings");
bc.onmessage = (e) => {
  // When settings are updated in another tab, update this tab's settings as well.
  runInAction(() => set(settings, e.data));
};

// ==================================================================
// SETTINGS STORE
// ==================================================================

type DialColors = Record<string, string>;
type DialImages = Record<string, string>;
type ManualFavicons = Record<string, string>;

const defaultSettings = {
  colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "color-scheme-dark"
    : "color-scheme-light",
  customColor: "",
  customImage: "",
  defaultFolder: "",
  dialColors: {} as DialColors,
  dialImages: {} as DialImages,
  manualFavicons: {} as ManualFavicons,
  dialSize: "small",
  firstRun: !lastVersion,
  maxColumns: "7",
  newTab: false,
  showAlertBanner: !lastVersion || isUpgrade,
  squareDials: true,
  columnGap: 28,
  rowGap: 28,
  titleOpacity: 0.75,
  themeOption: "System Theme",
  wallpaper: "",
};

export const settings = makeAutoObservable({
  colorScheme,
  customColor:
    storage[`${apiVersion}-custom-color`] || defaultSettings.customColor,
  customImage,
  defaultFolder:
    storage[`${apiVersion}-default-folder`] || defaultSettings.defaultFolder,
  dialColors:
    (storage[`${apiVersion}-dial-colors`] as DialColors) ||
    defaultSettings.dialColors,
  dialImages:
    (storage[`${apiVersion}-dial-images`] as DialImages) ||
    defaultSettings.dialImages,
  manualFavicons:
    (storage[`${apiVersion}-manual-favicons`] as ManualFavicons) ||
    defaultSettings.manualFavicons,
  dialSize: storage[`${apiVersion}-dial-size`] || defaultSettings.dialSize,
  firstRun: defaultSettings.firstRun,
  maxColumns:
    storage[`${apiVersion}-max-columns`] || defaultSettings.maxColumns,
  newTab: storage[`${apiVersion}-new-tab`] ?? defaultSettings.newTab,
  showAlertBanner: defaultSettings.showAlertBanner,
  squareDials: true,
  columnGap: storage[`${apiVersion}-column-gap`] || defaultSettings.columnGap,
  rowGap: storage[`${apiVersion}-row-gap`] || defaultSettings.rowGap,
  titleOpacity:
    storage[`${apiVersion}-title-opacity`] ?? defaultSettings.titleOpacity,
  themeOption,
  wallpaper,
  handleClearColor(id: string) {
    if (settings.dialColors[id]) {
      remove(settings.dialColors, id);
      browser.storage.local.set({
        [`${apiVersion}-dial-colors`]: { ...settings.dialColors },
      });
      bc.postMessage({ dialColors: { ...settings.dialColors } });
    }
  },
  handleClearThumbnail(id: string) {
    if (settings.dialImages[id]) {
      remove(settings.dialImages, id);
      browser.storage.local.set({
        [`${apiVersion}-dial-images`]: { ...settings.dialImages },
      });
      bc.postMessage({ dialImages: { ...settings.dialImages } });
    }
  },
  handleClearManualFavicon(hostname: string) {
    if (settings.manualFavicons[hostname]) {
      remove(settings.manualFavicons, hostname);
      browser.storage.local.set({
        [`${apiVersion}-manual-favicons`]: { ...settings.manualFavicons },
      });
      bc.postMessage({ manualFavicons: { ...settings.manualFavicons } });
    }
  },
  handleCustomColor(value: string) {
    browser.storage.local.set({ [`${apiVersion}-custom-color`]: value });
    settings.customColor = value;
    settings.handleWallpaper("custom-color");
    bc.postMessage({ customColor: value });
  },
  handleCustomImage() {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = "image/*";
    i.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const image = target.files?.[0];
      if (!image) return;

      if (!image.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }

      const imageURI = URL.createObjectURL(image);
      const base64 = await blobToBase64(image);
      await browser.storage.local.set({
        [`${apiVersion}-custom-image`]: base64,
      });
      settings.customImage = imageURI;
      settings.handleWallpaper("custom-image");
      bc.postMessage({ customImage: imageURI });
    };
    i.click();
  },
  handleDefaultFolder(value: string) {
    browser.storage.local.set({ [`${apiVersion}-default-folder`]: value });
    settings.defaultFolder = value;
    bc.postMessage({ defaultFolder: value });
  },
  handleDialColors(id: string, value: string) {
    set(settings.dialColors, id, value);
    browser.storage.local.set({
      [`${apiVersion}-dial-colors`]: { ...settings.dialColors },
    });
    bc.postMessage({
      dialColors: { ...settings.dialColors },
    });
  },
  handleDialSize(value: string) {
    browser.storage.local.set({ [`${apiVersion}-dial-size`]: value });
    settings.dialSize = value;
    bc.postMessage({ dialSize: value });
  },
  handleMaxColumns(value: string) {
    browser.storage.local.set({ [`${apiVersion}-max-columns`]: value });
    settings.maxColumns = value;
    bc.postMessage({ maxColumns: value });
  },
  handleRowGap(value: number) {
    browser.storage.local.set({ [`${apiVersion}-row-gap`]: value });
    settings.rowGap = value;
    bc.postMessage({ rowGap: value });
  },
  handleColumnGap(value: number) {
    browser.storage.local.set({ [`${apiVersion}-column-gap`]: value });
    settings.columnGap = value;
    bc.postMessage({ columnGap: value });
  },
  handleTitleOpacity(value: number) {
    browser.storage.local.set({ [`${apiVersion}-title-opacity`]: value });
    settings.titleOpacity = value;
    bc.postMessage({ titleOpacity: value });
  },
  handleNewTab(value: boolean) {
    browser.storage.local.set({ [`${apiVersion}-new-tab`]: value });
    settings.newTab = value;
    bc.postMessage({ newTab: value });
  },
  handleSelectThumbnail(id: string) {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = "image/*";
    i.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const image = target.files?.[0];
      if (!image) return;

      if (!image.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }

      const base64 = await blobToBase64(image);
      settings.dialImages = { ...settings.dialImages, [id]: base64 };
      browser.storage.local.set({
        [`${apiVersion}-dial-images`]: { ...settings.dialImages },
      });
      bc.postMessage({
        dialImages: { ...settings.dialImages },
      });
    };
    i.click();
  },
  handleThemeOption(value: string) {
    browser.storage.local.set({ [`${apiVersion}-theme-option`]: value });
    settings.themeOption = value;
    settings.colorScheme = getColorScheme(value);
    bc.postMessage({
      themeOption: value,
      colorScheme: settings.colorScheme,
    });
  },
  handleWallpaper(value: string) {
    browser.storage.local.set({ [`${apiVersion}-wallpaper`]: value });
    settings.wallpaper = value;
    bc.postMessage({ wallpaper: value });
  },
  async resetSettings() {
    await browser.storage.local.clear();
    location.reload();
  },
  saveToJSON() {
    const data = JSON.stringify(storage);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `easy-speed-dial-backup-${new Date().toISOString()}.json`;
    a.click();
  },
  restoreFromJSON() {
    const i = document.createElement("input");
    i.type = "File";
    i.accept = "application/json";
    i.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = JSON.parse(e.target?.result as string);
        await browser.storage.local.clear();
        await browser.storage.local.set(data);
        location.reload();
      };
      reader.readAsText(file);
    };
    i.click();
  },
});

function base64ToBlob(base64: string) {
  const byteString = atob(base64.split(",")[1]);
  const mimeString = base64.split(",")[0].split(":")[1].split(";")[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
