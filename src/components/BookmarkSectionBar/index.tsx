import { clsx } from "clsx/lite";
import { observer } from "mobx-react-lite";

import { bookmarks } from "#stores/useBookmarks";
import { settings } from "#stores/useSettings";

import "./styles.css";

export const BookmarkSectionBar = observer(function BookmarkSectionBar() {
  if (
    !settings.showBookmarkSectionBar ||
    bookmarks.rootSections.length < 2
  ) {
    return null;
  }

  return (
    <nav className="BookmarkSectionBar" aria-label="Bookmark locations">
      <ul className="BookmarkSectionBar-list">
        {bookmarks.rootSections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className={clsx(
                "BookmarkSectionBar-link",
                bookmarks.activeRootSectionId === section.id && "active",
              )}
              onClick={() => void bookmarks.goToFolder(section.id)}
            >
              {section.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
});
