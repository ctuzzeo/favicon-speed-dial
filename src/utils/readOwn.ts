/**
 * Read a key from a plain-object record only when it's an OWN property, so a key that
 * collides with an inherited `Object.prototype` member (a bookmark hostname of
 * `constructor`, `__proto__`, `hasOwnProperty`, …) reads `undefined` instead of the
 * inherited value. Mirrors the `Object.hasOwn` guard used for `externalProviderHosts`
 * in the settings store — the per-site favicon maps are keyed by attacker-influenceable
 * bookmark hostnames, so their reads need the same guard.
 *
 * The `record[key]` read happens FIRST, before the `Object.hasOwn` filter, on purpose:
 * these records are MobX observables, and a MobX object only registers a reactive
 * dependency on an absent key through the `get` trap (reading `record[key]`). Guarding
 * with `Object.hasOwn` *first* would return before that read for a not-yet-present key,
 * so a value later `set()` on that key would never re-render the observer (e.g. picking
 * a favicon for a dial that had none). `key in record` would restore reactivity but is
 * NOT prototype-safe (`"constructor" in {}` is `true`), so we read-then-filter instead.
 */
export function readOwn<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!record) return undefined;
  const value = record[key];
  return Object.hasOwn(record, key) ? value : undefined;
}
