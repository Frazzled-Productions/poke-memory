/**
 * Unit tests for the readLocalStorage helper.
 *
 * The node vitest project runs without a real browser, so window is not
 * defined by default. We stub it per test to exercise both the SSR guard
 * (window undefined) and the browser paths (key absent, key present, parse
 * throws, storage access throws).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalStorage } from "./readLocalStorage";

function makeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
  } as Storage;
}

const identity = (raw: string) => raw;
const parseJson = <T>(raw: string) => JSON.parse(raw) as T;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readLocalStorage — SSR guard", () => {
  it("returns the fallback when window is undefined", () => {
    // Do not stub window — let it remain undefined (node environment).
    expect(readLocalStorage("any-key", identity, "fallback")).toBe("fallback");
  });

  it("returns a null fallback when window is undefined", () => {
    expect(readLocalStorage("any-key", parseJson, null)).toBeNull();
  });
});

describe("readLocalStorage — key absent", () => {
  it("returns the fallback when the key is not present", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(readLocalStorage("missing-key", identity, "fallback")).toBe("fallback");
  });

  it("returns a null fallback for missing key with null default", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(readLocalStorage("missing-key", parseJson, null)).toBeNull();
  });

  it("returns an empty-array fallback for missing key", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(readLocalStorage("missing-key", parseJson, [])).toEqual([]);
  });
});

describe("readLocalStorage — key present", () => {
  it("parses and returns the stored value", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "my-key": '"hello"' }) });
    expect(readLocalStorage("my-key", (raw) => JSON.parse(raw) as string, "fallback")).toBe("hello");
  });

  it("passes the raw string directly to parse", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "raw-key": "raw value" }) });
    expect(readLocalStorage("raw-key", identity, "fallback")).toBe("raw value");
  });

  it("returns a parsed object", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "obj-key": '{"a":1}' }) });
    expect(readLocalStorage("obj-key", parseJson, null)).toEqual({ a: 1 });
  });
});

describe("readLocalStorage — parse throws", () => {
  it("returns the fallback when parse throws on malformed JSON", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "bad-key": "{not valid json" }) });
    expect(readLocalStorage("bad-key", parseJson, "default")).toBe("default");
  });

  it("returns a null fallback when parse throws", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "bad-key": "!!!" }) });
    expect(readLocalStorage("bad-key", parseJson, null)).toBeNull();
  });

  it("returns an empty-array fallback when parse throws", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "bad-key": "???" }) });
    expect(readLocalStorage("bad-key", parseJson, [])).toEqual([]);
  });

  it("does not propagate exceptions thrown by parse", () => {
    vi.stubGlobal("window", { localStorage: makeStorage({ "boom-key": "anything" }) });
    const throwing = (_raw: string): string => { throw new Error("deliberately thrown"); };
    expect(() => readLocalStorage("boom-key", throwing, "safe")).not.toThrow();
    expect(readLocalStorage("boom-key", throwing, "safe")).toBe("safe");
  });
});

describe("readLocalStorage — storage access throws", () => {
  it("returns the fallback when window.localStorage.getItem throws", () => {
    const brokenStorage = {
      getItem: () => { throw new DOMException("SecurityError"); },
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: brokenStorage });
    expect(readLocalStorage("any-key", identity, "safe")).toBe("safe");
  });
});

describe("readLocalStorage — type parameter", () => {
  it("infers the return type from the parse function", () => {
    vi.stubGlobal("window", {
      localStorage: makeStorage({ "num-key": "42" }),
    });
    const result = readLocalStorage("num-key", (raw) => parseInt(raw, 10), 0);
    // TypeScript should infer `result` as `number` — enforce at runtime too.
    expect(typeof result).toBe("number");
    expect(result).toBe(42);
  });
});
