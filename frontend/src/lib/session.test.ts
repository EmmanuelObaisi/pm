import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoredSession, loadSession, storeSession } from "@/lib/session";
import { makeUser } from "@/test/factories";

const session = { token: "abc", user: makeUser({ username: "alice" }) };

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("session storage", () => {
  it("round-trips a session", () => {
    storeSession(session);
    expect(loadSession()).toEqual(session);
  });

  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
  });

  it("clears a stored session", () => {
    storeSession(session);
    clearStoredSession();
    expect(loadSession()).toBeNull();
  });

  it("ignores a stored value that is not valid JSON", () => {
    window.localStorage.setItem("pm.session", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("ignores a stored value with the wrong shape", () => {
    window.localStorage.setItem("pm.session", JSON.stringify({ token: 1 }));
    expect(loadSession()).toBeNull();
    window.localStorage.setItem("pm.session", JSON.stringify({ token: "a" }));
    expect(loadSession()).toBeNull();
  });

  it("survives storage that throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadSession()).toBeNull();
  });

  it("survives storage that throws on write or remove", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeSession(session)).not.toThrow();
    expect(() => clearStoredSession()).not.toThrow();
  });
});
