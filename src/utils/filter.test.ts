import type { Bookmarks } from "webextension-polyfill";

import { describe, expect, it } from "vitest";

import { filter, getLinkName } from "./filter";

function node(partial: Partial<Bookmarks.BookmarkTreeNode>): Bookmarks.BookmarkTreeNode {
  return { id: "1", title: "", index: 0, ...partial } as Bookmarks.BookmarkTreeNode;
}

describe("filter", () => {
  it("keeps a normal http(s) bookmark, tagged as bookmark", () => {
    const out = filter([node({ title: "Example", url: "https://example.com/" })]);
    expect(out).toEqual([
      {
        id: "1",
        title: "Example",
        url: "https://example.com/",
        type: "bookmark",
        name: ["example", "com"],
        parentId: undefined,
        index: 0,
      },
    ]);
  });

  it("keeps a folder (no url), tagged as folder", () => {
    const out = filter([node({ title: "My Folder", url: undefined })]);
    expect(out).toEqual([
      {
        id: "1",
        title: "My Folder",
        type: "folder",
        name: ["My Folder"],
        parentId: undefined,
        index: 0,
      },
    ]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:http://example.com/00000000",
    "file:///etc/passwd",
    "chrome://settings",
    "edge://settings",
    "about:blank",
    "place:type=6",
    // scheme match is case-insensitive
    "JavaScript:alert(1)",
  ])("drops the dangerous-scheme bookmark %s", (url) => {
    const out = filter([node({ title: "Dangerous", url })]);
    expect(out).toEqual([]);
  });

  it("drops separators", () => {
    const out = filter([node({ type: "separator" })]);
    expect(out).toEqual([]);
  });

  it("keeps safe bookmarks alongside dropping dangerous ones", () => {
    const out = filter([
      node({ id: "safe", title: "Safe", url: "https://safe.example/" }),
      node({ id: "danger", title: "Danger", url: "javascript:alert(1)" }),
    ]);
    expect(out.map((b) => b.id)).toEqual(["safe"]);
  });
});

describe("getLinkName", () => {
  it("splits a domain into labeled parts", () => {
    expect(getLinkName("https://www.example.com/path")).toEqual(["example", "com"]);
  });

  it("falls back to the scheme suffix for non-:// URLs", () => {
    expect(getLinkName("mailto:user@example.com")).toEqual(["user@example.com"]);
  });
});
