import { afterEach, describe, expect, it, vi } from "vitest";

import { dominantColorFromImageData, fetchImageBlobBounded } from "./imageColor";

type RGBA = [number, number, number, number];

function makePixels(colors: RGBA[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return data;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

describe("dominantColorFromImageData", () => {
  it("returns null when every pixel is transparent", () => {
    expect(
      dominantColorFromImageData(
        makePixels([
          [255, 0, 0, 0],
          [0, 255, 0, 0],
        ]),
      ),
    ).toBeNull();
  });

  it("picks the vivid brand colour over a white background", () => {
    const px: RGBA[] = [];
    for (let i = 0; i < 20; i++) px.push([255, 255, 255, 255]);
    for (let i = 0; i < 5; i++) px.push([220, 30, 30, 255]);
    const hex = dominantColorFromImageData(makePixels(px));
    expect(hex).not.toBeNull();
    const [r, g, b] = channels(hex!);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(120);
  });

  it("ignores transparent pixels when bucketing", () => {
    const hex = dominantColorFromImageData(
      makePixels([
        [10, 10, 200, 255],
        [10, 10, 200, 255],
        [10, 10, 200, 255],
        [255, 0, 0, 0], // transparent red — must be ignored
        [255, 0, 0, 0],
      ]),
    );
    expect(hex).not.toBeNull();
    const [, , b] = channels(hex!);
    expect(b).toBeGreaterThan(150);
  });

  it("falls back to the most common opaque colour for greyscale logos", () => {
    const px: RGBA[] = [];
    for (let i = 0; i < 10; i++) px.push([90, 90, 90, 255]);
    for (let i = 0; i < 3; i++) px.push([255, 255, 255, 255]);
    const hex = dominantColorFromImageData(makePixels(px));
    expect(hex).not.toBeNull();
    const [r, g, b] = channels(hex!);
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(120);
    expect(Math.abs(r - g)).toBeLessThan(16);
    expect(Math.abs(g - b)).toBeLessThan(16);
  });
});

function makeStreamResponse(
  chunks: Uint8Array[],
  opts?: { ok?: boolean; contentType?: string },
): Response {
  let i = 0;
  const reader = {
    read: async () => {
      if (i < chunks.length) return { done: false, value: chunks[i++] };
      return { done: true, value: undefined };
    },
    cancel: async () => {},
  };
  return {
    ok: opts?.ok ?? true,
    body: { getReader: () => reader },
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? opts?.contentType ?? "image/png"
          : null,
    },
  } as unknown as Response;
}

describe("fetchImageBlobBounded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the assembled blob for a small valid image response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeStreamResponse([new Uint8Array([1, 2, 3, 4])])),
    );
    const blob = await fetchImageBlobBounded("https://x.example/icon.png", () => true);
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(4);
    expect(blob!.type).toBe("image/png");
  });

  it("rejects a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeStreamResponse([new Uint8Array([1])], { ok: false })),
    );
    const blob = await fetchImageBlobBounded("https://x.example/icon.png", () => true);
    expect(blob).toBeNull();
  });

  it("rejects a response whose content-type isn't image/*", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeStreamResponse([new Uint8Array([1, 2, 3])], { contentType: "text/plain" }),
      ),
    );
    const blob = await fetchImageBlobBounded("https://x.example/icon.png", () => true);
    expect(blob).toBeNull();
  });

  it("cancels and returns null once the byte cap is exceeded", async () => {
    let cancelled = false;
    const oversizedChunk = new Uint8Array(9 * 1024 * 1024); // 9 MiB > 8 MiB cap
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: oversizedChunk })
        .mockResolvedValue({ done: true, value: undefined }),
      cancel: async () => {
        cancelled = true;
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: { getReader: () => reader },
        headers: { get: () => "image/png" },
      })),
    );
    const blob = await fetchImageBlobBounded("https://x.example/huge.png", () => true);
    expect(blob).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("cancels and returns null once alive() goes false mid-stream", async () => {
    let cancelled = false;
    const reader = {
      read: vi.fn(async () => ({ done: false, value: new Uint8Array([1]) })),
      cancel: async () => {
        cancelled = true;
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: { getReader: () => reader },
        headers: { get: () => "image/png" },
      })),
    );
    const blob = await fetchImageBlobBounded("https://x.example/icon.png", () => false);
    expect(blob).toBeNull();
    expect(cancelled).toBe(true);
  });
});
