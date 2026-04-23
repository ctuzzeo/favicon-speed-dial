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
          // Load the custom dial color for this bookmark, if set.
          const customColor = settings.dialColors[modals.editingBookmarkId];
          setCustomDialColor(customColor || "");
          // Load transparent preference. Default to true if not explicitly set.
          const transparent = settings.dialTransparent[modals.editingBookmarkId] ?? true;
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

  const defaultDialColor = dialColors(
    getLinkName(bookmarkType === "folder" ? bookmarkTitle : bookmarkURL),
  );
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
      // Save a custom dial color if it differs from the default.
      // Remove the custom dial color if it matches the default.
      const color = dialColor !== defaultDialColor ? customDialColor : "";
      if (color && modals.editingBookmarkId) {
        settings.handleDialColors(modals.editingBookmarkId, color);
      } else if (modals.editingBookmarkId) {
        settings.handleClearColor(modals.editingBookmarkId);
      }

      // Save transparent preference.
      if (modals.editingBookmarkId) {
        settings.handleDialTransparent(modals.editingBookmarkId, isTransparent);
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
      if (dialColor !== defaultDialColor) {
        // Save a custom dial color if it differs from the default.
        settings.handleDialColors(newBookmark.id, customDialColor);
      }
      // Save transparent preference.
      settings.handleDialTransparent(newBookmark.id, isTransparent);
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
