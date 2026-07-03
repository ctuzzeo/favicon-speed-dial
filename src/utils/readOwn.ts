/**
 * Read a key from a plain-object record only when it's an OWN property, so a key that
 * collides with an inherited `Object.prototype` member (a bookmark hostname of
 * `constructor`, `__proto__`, `hasOwnProperty`, …) reads `undefined` instead of the
 * inherited value. Mirrors the `Object.hasOwn` guard used for `externalProviderHosts`
 * in the settings store — the per-site favicon maps are keyed by attacker-influenceable
 * bookmark hostnames, so their reads need the same guard.
 */
export function readOwn<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!record || !Object.hasOwn(record, key)) return undefined;
  return record[key];
}
