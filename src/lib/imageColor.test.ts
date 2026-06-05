import { describe, expect, it } from "vitest";

import { dominantColorFromImageData } from "./imageColor";

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
