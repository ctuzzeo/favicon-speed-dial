import { autorun, observable, runInAction, set } from "mobx";
import { describe, expect, it } from "vitest";

import { readOwn } from "./readOwn";

describe("readOwn", () => {
  it("returns an own property's value", () => {
    expect(readOwn({ "example.com": "https://cdn/x.png" }, "example.com")).toBe(
      "https://cdn/x.png",
    );
  });

  it("returns undefined for an absent key", () => {
    expect(readOwn({ "example.com": "x" }, "other.com")).toBeUndefined();
  });

  it("does not read inherited Object.prototype members", () => {
    // A bookmark hostname like "constructor" / "__proto__" / "hasOwnProperty" must not
    // resolve to the inherited prototype value.
    const record: Record<string, string> = {};
    expect(readOwn(record, "constructor")).toBeUndefined();
    expect(readOwn(record, "__proto__")).toBeUndefined();
    expect(readOwn(record, "hasOwnProperty")).toBeUndefined();
    expect(readOwn(record, "toString")).toBeUndefined();
  });

  it("still returns an own value that shadows a prototype name", () => {
    expect(readOwn({ constructor: "https://cdn/c.png" }, "constructor")).toBe(
      "https://cdn/c.png",
    );
  });

  it("returns undefined for an undefined record or empty key", () => {
    expect(readOwn(undefined, "example.com")).toBeUndefined();
    expect(readOwn({ "": "x" } as Record<string, string>, "")).toBe("x");
  });

  // Regression: the reads go through MobX observables, and a MobX object only tracks an
  // absent key via the `get` trap. An `Object.hasOwn`-first guard would return before
  // that read, so setting a key that was absent would not re-render the observer (a dial
  // that had no manual favicon wouldn't update when one is picked). read-first fixes it.
  it("reacts when a previously-absent key is set on a MobX observable", () => {
    const obs = observable.object<Record<string, string>>({});
    let last: string | undefined;
    let runs = 0;
    const dispose = autorun(() => {
      last = readOwn(obs, "example.com");
      runs++;
    });
    expect(runs).toBe(1);
    expect(last).toBeUndefined();

    runInAction(() => set(obs, "example.com", "https://cdn/x.png"));
    expect(runs).toBe(2); // re-ran: the absent→present transition was tracked
    expect(last).toBe("https://cdn/x.png");

    dispose();
  });

  it("stays prototype-safe on a MobX observable (inherited key not read)", () => {
    const obs = observable.object<Record<string, string>>({});
    expect(readOwn(obs, "constructor")).toBeUndefined();
  });
});
