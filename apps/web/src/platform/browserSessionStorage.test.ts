import { createBrowserSessionStorage } from "./browserSessionStorage";

describe("browser session storage", () => {
  it("namespaces both app and Supabase-compatible accessors", () => {
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
});
