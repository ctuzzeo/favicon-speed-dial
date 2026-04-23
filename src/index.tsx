import { reaction, when } from "mobx";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Bookmarks } from "#pages/Bookmarks";
import { bookmarks } from "#stores/useBookmarks";
import { settings } from "#stores/useSettings";

async function initializeApp() {
  const setFolder = async (folderId: string | null) => {
    const isValid = folderId
      ? await bookmarks.validateFolderExists(folderId)
      : false;
    const targetId = isValid ? folderId! : await bookmarks.getBookmarksBarId();

    bookmarks.changeFolder(targetId);
    // Update the URL hash if it is missing or incorrect.
    if (location.hash.slice(1) !== targetId) {
      history.replaceState(null, "", `#${targetId}`);
    }
  };

  // Switch folders when the URL hash changes (e.g., when using browser navigation buttons).
  window.addEventListener("hashchange", () => {
    setFolder(location.hash.slice(1));
  });

  // Wait for settings to be loaded from storage before determining the initial folder.
  await when(() => settings.isLoaded);

  // Select and set the initial folder to display.
  const initialFolder =
    location.hash.slice(1) ||
    sessionStorage.getItem("last-folder") ||
    (settings.defaultFolder as string);
  await setFolder(initialFolder);

  // Reactively update the folder if the user changes the "Default Folder" in settings
  // and they are currently in a top-level folder (not a subfolder).
  reaction(
    () => settings.defaultFolder,
    (newDefault) => {
      // Only switch if we are at the "root" of the navigation (no parent folder)
      if (!bookmarks.parentId) {
        setFolder(newDefault);
      }
    }
  );
}

initializeApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bookmarks />
  </StrictMode>,
);
