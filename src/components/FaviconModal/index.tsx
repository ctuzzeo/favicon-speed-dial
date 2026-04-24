import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

import { Modal } from "#components/Modal";
import { getFaviconPickerCandidates } from "#lib/faviconResolve";
import { bookmarks } from "#stores/useBookmarks";
import { modals } from "#stores/useModals";
import { settings } from "#stores/useSettings";

import "./styles.css";

export const FaviconModal = observer(function FaviconModal() {
  const editingBookmarkId = modals.editingBookmarkId;
  const [bookmarkURL, setBookmarkURL] = useState("");
  const [candidates, setCandidates] = useState<{ name: string; url: string }[]>(
    [],
  );
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBookmarkData() {
      setLoading(true);
      setBookmarkURL("");
      setCandidates([]);
      setLoadedUrls({});

      const editingId = editingBookmarkId;
      if (!editingId) {
        setLoading(false);
        return;
      }

      const bookmark = await bookmarks.getBookmarkById(editingId);
      if (cancelled) return;

      if (bookmark?.url) {
        try {
          new URL(bookmark.url);
          setBookmarkURL(bookmark.url);
          setCandidates(
            await getFaviconPickerCandidates(bookmark.url, {
              externalFaviconProviders: settings.enableExternalFaviconProviders,
            }),
          );
        } catch {
          setBookmarkURL("");
          setCandidates([]);
        }
      }

      if (!cancelled) setLoading(false);
    }

    void loadBookmarkData();
    return () => {
      cancelled = true;
    };
    /* Re-fetch candidates when privacy toggle changes while modal context unchanged. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- MobX observable
  }, [editingBookmarkId, settings.enableExternalFaviconProviders]);

  function handleSelect(iconUrl: string) {
    if (!bookmarkURL) return;
    try {
      const hostname = new URL(bookmarkURL).hostname;
      settings.handleManualFavicon(hostname, iconUrl);
      modals.closeModal();
    } catch {
      /* invalid bookmark URL */
    }
  }

  const hasValidCandidates = Object.values(loadedUrls).some((v) => v);

  return (
    <Modal
      title="Select Favicon"
      width="min(92vw, 640px)"
      height="min(78vh, 680px)"
    >
      <div className="FaviconModal">
        <p className="description">
          Choose the best quality icon for{" "}
          <strong>{bookmarkURL || "this bookmark"}</strong>. The same sources
          are tried for every site; only icons that load on this origin are shown
          (missing rows usually mean that path is not hosted here, e.g. touch
          icons on a CDN).
        </p>

        {loading ? (
          <div className="loading">Searching for icons...</div>
        ) : (
          <>
            <div className="favicon-grid">
              {candidates.map((candidate) => (
                <button
                  key={`${candidate.name}-${candidate.url}`}
                  type="button"
                  className="favicon-candidate"
                  onClick={() => handleSelect(candidate.url)}
                  style={{
                    display: loadedUrls[candidate.url] ? "flex" : "none",
                  }}
                >
                  <div className="icon-wrapper">
                    <img
                      src={candidate.url}
                      alt={candidate.name}
                      onLoad={() =>
                        setLoadedUrls((prev) => ({
                          ...prev,
                          [candidate.url]: true,
                        }))
                      }
                      onError={() =>
                        setLoadedUrls((prev) => ({
                          ...prev,
                          [candidate.url]: false,
                        }))
                      }
                    />
                  </div>
                  <span className="provider-name">{candidate.name}</span>
                </button>
              ))}
            </div>
            {!hasValidCandidates && !loading && (
              <div className="no-candidates">
                No high-quality icons found for this site.
              </div>
            )}
          </>
        )}

        <div className="buttons">
          <button
            type="button"
            className="btn defaultBtn"
            onClick={() => modals.closeModal()}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
});
