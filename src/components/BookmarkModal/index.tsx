import type { FormEvent, MouseEvent } from "react";
import type { Bookmarks } from "webextension-polyfill";

import { clsx } from "clsx/lite";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { HexColorInput } from "react-colorful";

import { ColorPicker } from "#components/ColorPicker";
import { CaretDown } from "#components/icons/CaretDown.tsx";
import { Modal } from "#components/Modal";
import { Switch } from "#components/SettingsContent/Switch";
import { dialColors } from "#lib/dialColors";
import { resolveFaviconForBookmark } from "#lib/faviconResolve";
import { getImageDominantColor } from "#lib/imageColor";
import { hostnameForSiteKey } from "#lib/syncKeys";
import { bookmarks } from "#stores/useBookmarks";
import { colorPicker } from "#stores/useColorPicker";
import { modals } from "#stores/useModals";
import { settings } from "#stores/useSettings";
import { getLinkName } from "#utils/filter";

import "./styles.css";

export const BookmarkModal = observer(function BookmarkModal() {
  const [editingBookmark, setEditingBookmark] =
    useState<Bookmarks.BookmarkTreeNode | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkURL, setBookmarkURL] = useState("");
  const [parentFolderId, setparentFolderId] = useState(
    (bookmarks.currentFolder as { id: string }).id || "",
  );
  const [customDialColor, setCustomDialColor] = useState("");
  const [isTransparent, setIsTransparent] = useState(true);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const isEditing = modals.editingBookmarkId !== null;
  const bookmarkType = modals.isOpen?.includes("folder")
    ? "folder"
    : "bookmark";

  // Load bookmark details when editing an existing bookmark or folder.
  useEffect(() => {
    async function loadBookmarkData() {
      if (modals.editingBookmarkId) {
        const bookmark = await bookmarks.getBookmarkById(
          modals.editingBookmarkId,
        );
        if (bookmark) {
          setEditingBookmark(bookmark);
          setBookmarkTitle(bookmark.title || "");
          setBookmarkURL(bookmark.url || "");
          setparentFolderId(bookmark.parentId || "");
          // Colour + transparency are per-site (hostname) for bookmarks, with the legacy
          // by-id values as a fallback; folders stay keyed by id.
          const host = bookmark.url ? hostnameForSiteKey(bookmark.url) : "";
          const customColor =
            (host && settings.siteColors[host]) ||
            settings.dialColors[modals.editingBookmarkId] ||
            "";
          setCustomDialColor(customColor);
          const rawTransparent = host
            ? settings.siteTransparent[host]
            : undefined;
          const transparent =
            rawTransparent === "1"
              ? true
              : rawTransparent === "0"
                ? false
                : (settings.dialTransparent[modals.editingBookmarkId] ?? true);
          setIsTransparent(transparent);
        }
      } else {
        // Default to transparent for new bookmarks.
        setIsTransparent(true);
      }
    }

    loadBookmarkData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modals.editingBookmarkId]);

  // Detect the favicon's dominant colour so the editor can auto-match it when Transparent
  // is turned off. Mirrors what the dial shows (a manual pick, else the auto-resolved icon).
  useEffect(() => {
    setIconColor(null);
    const url = editingBookmark?.url;
    if (bookmarkType !== "bookmark" || !url) return;
    let cancelled = false;
    void (async () => {
      const host = hostnameForSiteKey(url);
      let iconUrl = host ? settings.manualFavicons?.[host] : undefined;
      if (!iconUrl) {
        const pick = await resolveFaviconForBookmark(url, () => !cancelled, {
          externalFaviconProviders: settings.externalAllowedForUrl(url),
        });
        iconUrl = pick?.url;
      }
      if (cancelled || !iconUrl) return;
      const color = await getImageDominantColor(iconUrl);
      if (!cancelled && color) setIconColor(color);
    })();
    return () => {
      cancelled = true;
    };
  }, [editingBookmark?.url, bookmarkType]);

  const nameHashColor = dialColors(
    getLinkName(bookmarkType === "folder" ? bookmarkTitle : bookmarkURL),
  );
  // For a bookmark, the default colour is the favicon's dominant colour (auto-match) when
  // detected; otherwise the name-hash colour. Folders always use the name-hash colour.
  const defaultDialColor =
    (bookmarkType === "bookmark" && iconColor) || nameHashColor;
  const dialColor = customDialColor
    ? customDialColor
    : (bookmarkType === "folder" && bookmarkTitle) ||
        (bookmarkType === "bookmark" && bookmarkURL)
      ? defaultDialColor
      : "";
  const disabled = bookmarkType === "folder" ? false : !bookmarkURL;
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isEditing) {
      // Persist colour + transparency. Bookmarks key these per-site (hostname) so the
      // change applies to every bookmark of that domain; folders (and any host-less
      // bookmark) stay by id. When not transparent, the colour saved is the shown colour
      // — a custom pick, else the auto-matched favicon colour.
      const id = modals.editingBookmarkId;
      const host =
        bookmarkType === "bookmark" && bookmarkURL
          ? hostnameForSiteKey(bookmarkURL)
          : "";
      const colorToSave =
        customDialColor || (!isTransparent ? defaultDialColor : "");
      const saveColor = Boolean(colorToSave) && colorToSave !== nameHashColor;
      if (host) {
        settings.handleSiteTransparent(host, isTransparent);
        if (saveColor) settings.handleSiteColor(host, colorToSave);
        else settings.handleClearSiteColor(host);
      } else if (id) {
        settings.handleDialTransparent(id, isTransparent);
        if (saveColor) settings.handleDialColors(id, colorToSave);
        else settings.handleClearColor(id);
      }
      // Determine which bookmark details have changed.
      const detailsChanged =
        ((bookmarkType === "folder" || bookmarkType === "bookmark") &&
          bookmarkTitle !== editingBookmark?.title) ||
        (bookmarkType === "bookmark" && bookmarkURL !== editingBookmark?.url);
      const parentChanged = parentFolderId !== editingBookmark?.parentId;

      let updatedBookmark: Bookmarks.BookmarkTreeNode | undefined;
      let closeModalOptions:
        | { focusAfterClosed?: FocusAfterClosed }
        | undefined;

      // Update bookmark details if they changed.
      if (detailsChanged && modals.editingBookmarkId) {
        updatedBookmark = await bookmarks.updateBookmark(
          modals.editingBookmarkId,
          {
            title: bookmarkTitle,
            ...(bookmarkType === "bookmark" ? { url: bookmarkURL } : {}),
          },
        );
        // Focus on the updated bookmark after closing.
        closeModalOptions = {
          focusAfterClosed: () =>
            document.querySelector(`[data-id="${updatedBookmark!.id}"]`),
        };
      }

      // Move bookmark to different folder if parent changed.
      if (parentChanged) {
        bookmarks.moveBookmark({
          id: modals.editingBookmarkId!,
          from: undefined,
          to: undefined,
          parentId: parentFolderId,
        });
        // Don't focus since the bookmark is no longer visible in current folder.
        closeModalOptions = undefined;
      }

      // Close modal with appropriate focus behavior:
      // - If details changed: focus on updated bookmark
      // - If parent changed: no focus (item moved away)
      // - If no changes: undefined lets modal handle focus automatically
      modals.closeModal(closeModalOptions);
    } else {
      const newBookmark = await bookmarks.createBookmark({
        url: bookmarkType === "bookmark" ? bookmarkURL : undefined,
        title: bookmarkTitle,
        parentId: parentFolderId,
      });
      // New bookmarks key colour/transparency per-site too; folders stay by id.
      const host =
        bookmarkType === "bookmark" && bookmarkURL
          ? hostnameForSiteKey(bookmarkURL)
          : "";
      const colorToSave =
        customDialColor || (!isTransparent ? defaultDialColor : "");
      const saveColor = Boolean(colorToSave) && colorToSave !== nameHashColor;
      if (host) {
        settings.handleSiteTransparent(host, isTransparent);
        if (saveColor) settings.handleSiteColor(host, colorToSave);
      } else {
        settings.handleDialTransparent(newBookmark.id, isTransparent);
        if (saveColor) settings.handleDialColors(newBookmark.id, colorToSave);
      }
      modals.closeModal({
        focusAfterClosed: () =>
          document.querySelector(`[data-id="${newBookmark.id}"]`),
      });
    }
  }

  function resetCustomDialColor(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setCustomDialColor("");
    (document.querySelector("#dial-color-input") as HTMLInputElement)?.focus();
  }

  return (
    <Modal
      {...{
        title: `${isEditing ? "Edit" : "New"} ${
          bookmarkType === "bookmark" ? "Bookmark" : "Folder"
        }`,
        initialFocus: "#title-input",
        width: "400px",
      }}
    >
      <div className="BookmarkModal">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label htmlFor="title-input">Name:</label>
            <input
              type="text"
              value={bookmarkTitle}
              className="input"
              id="title-input"
              onChange={(e) => setBookmarkTitle(e.target.value)}
              autoComplete="off"
            />
            {bookmarkType === "bookmark" && (
              <>
                <label htmlFor="url-input">URL:</label>
                <input
                  type="text"
                  value={bookmarkURL}
                  className="input"
                  id="url-input"
                  onChange={(e) => setBookmarkURL(e.target.value)}
                  autoComplete="off"
                  required
                />
              </>
            )}
            <label htmlFor="folder-select">Folder:</label>
            <div className="folder-select">
              <select
                id="folder-select"
                value={parentFolderId}
                onChange={(e) => setparentFolderId(e.target.value)}
                className="input"
              >
                {bookmarks.folders.map(
                  (folder: { id: string; title: string }) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.title}
                    </option>
                  ),
                )}
              </select>
              <CaretDown />
            </div>
            <label htmlFor="transparent-toggle">Transparent:</label>
            <div className="transparent-toggle">
              <Switch
                id="transparent-toggle"
                checked={isTransparent}
                onClick={() => setIsTransparent(!isTransparent)}
                className="switch-root"
              >
                <span className="switch-thumb" />
              </Switch>
            </div>
            <label htmlFor="dial-color-input" className={clsx(isTransparent && "disabled")}>Color:</label>
            <div className={clsx("dial-color-input", isTransparent && "disabled")}>
              <button
                className="btn defaultBtn colorBtn"
                style={{ backgroundColor: dialColor }}
                onClick={colorPicker.openColorPicker}
                aria-label="Open color picker"
                type="button"
                disabled={isTransparent}
              />
              {colorPicker.isOpen && !isTransparent && (
                <ColorPicker
                  {...{
                    color: dialColor,
                    handler: setCustomDialColor,
                    label: "Dial Color",
                  }}
                />
              )}
              <HexColorInput
                color={dialColor}
                id="dial-color-input"
                onChange={(color) => {
                  setCustomDialColor(color);
                  setIsTransparent(false);
                }}
                className={clsx(
                  "input",
                  dialColor && dialColor !== defaultDialColor && "connected",
                )}
                prefixed={true}
                disabled={isTransparent}
              />
              {dialColor && dialColor !== defaultDialColor && (
                <button
                  className="btn defaultBtn resetBtn"
                  onClick={resetCustomDialColor}
                  type="button"
                  disabled={isTransparent}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          <div className="buttons">
            <button type="submit" className="btn submitBtn" disabled={disabled}>
              Submit
            </button>
            <button
              type="button"
              className="btn defaultBtn"
              onClick={() => modals.closeModal()}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
});
