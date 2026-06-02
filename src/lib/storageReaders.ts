/**
 * Pure helpers for reading typed values out of a `browser.storage` snapshot,
 * each falling back to a default when the stored value is missing or the wrong
 * type. Extracted from the settings store so they can be unit-tested in
 * isolation (importing the store triggers its singleton initialization).
 */

export type StorageSnapshot = Record<string, unknown>;

export function readStorageString(
  snapshot: StorageSnapshot,
  key: string,
  fallback: string,
) {
  const v = snapshot[key];
  return typeof v === "string" ? v : fallback;
}

export function readStorageStringOrFallback(
  snapshot: StorageSnapshot,
  key: string,
  fallback: string,
) {
  const v = readStorageString(snapshot, key, "");
  return v || fallback;
}

export function readStorageBoolean(
  snapshot: StorageSnapshot,
  key: string,
  fallback: boolean,
) {
  const v = snapshot[key];
  return typeof v === "boolean" ? v : fallback;
}

export function readStorageNumber(
  snapshot: StorageSnapshot,
  key: string,
  fallback: number,
) {
  const v = snapshot[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

export function readStorageRecord<T extends Record<string, unknown>>(
  snapshot: StorageSnapshot,
  key: string,
  fallback: T,
): T {
  const v = snapshot[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
}
