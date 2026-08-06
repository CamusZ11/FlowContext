import { createBrowserSessionStorage } from "./browserSessionStorage";

describe("browser session storage", () => {
  it("uses browser sessionStorage for the explicitly non-production credential", () => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    const storage = createBrowserSessionStorage(undefined, "flowcontext-dev-test");

    storage.set("flowcontext.device-token", "temporary-token");

    expect(window.sessionStorage.getItem("flowcontext-dev-test:flowcontext.device-token")).toBe("temporary-token");
    expect(window.localStorage.getItem("flowcontext-dev-test:flowcontext.device-token")).toBeNull();
  });

  it("namespaces both app and browser-compatible accessors", () => {
    const values = new Map<string, string>();
    const backing = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const storage = createBrowserSessionStorage(backing, "flowcontext-test");

    storage.set("auth-token", "secret");
    expect(storage.getItem("auth-token")).toBe("secret");
    expect(values.has("flowcontext-test:auth-token")).toBe(true);
    storage.removeItem("auth-token");
    expect(storage.get("auth-token")).toBeNull();
  });

  it("treats an invalid browser storage object as unavailable", () => {
    const storage = createBrowserSessionStorage({} as unknown as Storage);

    expect(storage.get("device-id")).toBeNull();
    expect(() => storage.set("device-id", "device-1")).not.toThrow();
  });
});
