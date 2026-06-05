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

  // Third-party providers are opt-in per site; this drives the toggle below and
  // re-fetches candidates when it's flipped.
  const externalOn = settings.externalAllowedForUrl(bookmarkURL);

  // Resolve the bookmark's URL when the editing target changes. Kept separate from the
  // candidate fetch so the per-host toggle (externalOn) can't feed back into bookmarkURL
  // and cause the effect to loop.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBookmarkURL("");
    setCandidates([]);
    setLoadedUrls({});
    if (!editingBookmarkId) {
      setLoading(false);
      return;
    }
    bookmarks.getBookmarkById(editingBookmarkId).then((bookmark) => {
      if (cancelled) return;
      let url = "";
      if (bookmark?.url) {
        try {
          new URL(bookmark.url);
          url = bookmark.url;
        } catch {
          /* invalid bookmark URL */
        }
      }
      setBookmarkURL(url);
      if (!url) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [editingBookmarkId]);

  // Fetch candidates for the resolved URL + the current per-site provider setting.
  // Re-runs when the toggle (externalOn) flips. (Results are cached, so re-opening the
  // same site is instant.)
  useEffect(() => {
    if (!bookmarkURL) return;
    let cancelled = false;
    setLoading(true);
    setCandidates([]);
    setLoadedUrls({});
    getFaviconPickerCandidates(bookmarkURL, {
      externalFaviconProviders: externalOn,
    })
      .then((found) => {
        if (cancelled) return;
        setCandidates(found);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookmarkURL, externalOn]);

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

  // Surface the favicon currently applied to this site even when its source isn't in
  // the generated list (e.g. a mirror picked earlier, now that external providers are
  // off) — otherwise the dial shows an icon the picker doesn't, which is confusing.
  let currentHostname = "";
  try {
    if (bookmarkURL) currentHostname = new URL(bookmarkURL).hostname;
  } catch {
    /* invalid bookmark URL */
  }
  const currentManual = currentHostname
    ? settings.manualFavicons[currentHostname]
    : undefined;
  const displayCandidates =
    currentManual && !candidates.some((c) => c.url === currentManual)
      ? [{ name: "Current selection", url: currentManual }, ...candidates]
      : candidates;

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

        {bookmarkURL && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              margin: "0 0 14px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={externalOn}
              onChange={(e) =>
                settings.handleExternalForHost(currentHostname, e.target.checked)
              }
            />
            Use third-party providers (Google, etc.) for this site
          </label>
        )}

        {loading ? (
          <div className="loading">Searching for icons...</div>
        ) : (
          <>
            <div className="favicon-grid">
              {displayCandidates.map((candidate) => (
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
