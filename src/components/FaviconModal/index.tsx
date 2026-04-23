import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "#components/Modal";
import { bookmarks } from "#stores/useBookmarks";
import { modals } from "#stores/useModals";
import { settings } from "#stores/useSettings";

import "./styles.css";

type Provider = {
  name: string;
  getUrl: (domain: string, url: string) => string;
};

const ALL_PROVIDERS: Provider[] = [
  {
    name: "Native Cache",
    getUrl: (_domain: string, url: string) =>
      `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=128`,
  },
  {
    name: "DuckDuckGo",
    getUrl: (domain: string) =>
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  },
  {
    name: "Google S2",
    getUrl: (domain: string) =>
      `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  },
  {
    name: "Clearbit",
    getUrl: (domain: string) => `https://logo.clearbit.com/${domain}`,
  },
  {
    name: "IconHorse",
    getUrl: (domain: string) => `https://icon.horse/icon/${domain}`,
  },
];

function activeProviders(): Provider[] {
  const chrome =
    typeof __CHROME__ !== "undefined" && __CHROME__;
  return ALL_PROVIDERS.filter(
    (p) => p.name !== "Native Cache" || chrome,
  );
}

export const FaviconModal = observer(function FaviconModal() {
  const editingBookmarkId = modals.editingBookmarkId;
  const [bookmarkURL, setBookmarkURL] = useState("");
  const [candidates, setCandidates] = useState<{ name: string; url: string }[]>(
    [],
  );
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const providers = useMemo(() => activeProviders(), []);

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
          const fullHostname = new URL(bookmark.url).hostname;
          const rootDomain = fullHostname.replace(/^www\./, "");

          setBookmarkURL(bookmark.url);
          const urls = providers.map((p) => ({
            name: p.name,
            url: p.getUrl(
              p.name === "Native Cache" ? fullHostname : rootDomain,
              bookmark.url!,
            ),
          }));
          setCandidates(urls);
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
  }, [editingBookmarkId, providers]);

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
    <Modal title="Select Favicon" width="450px">
      <div className="FaviconModal">
        <p className="description">
          Choose the best quality icon for{" "}
          <strong>{bookmarkURL || "this bookmark"}</strong>. Only icons that
          load successfully are shown below.
        </p>

        {loading ? (
          <div className="loading">Searching for icons...</div>
        ) : (
          <>
            <div className="favicon-grid">
              {candidates.map((candidate) => (
                <button
                  key={candidate.name}
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
