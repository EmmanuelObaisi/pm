import "@testing-library/jest-dom";

// jsdom does not implement scrollIntoView, which the chat panel uses to keep
// the newest message in view.
Element.prototype.scrollIntoView = () => {};

// This jsdom build exposes sessionStorage but not localStorage, so stand one
// up on the same Storage interface the session module expects.
if (typeof window.localStorage === "undefined") {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: storage, writable: true });
  Object.setPrototypeOf(storage, Storage.prototype);
}
