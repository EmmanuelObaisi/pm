import type { Session } from "@/lib/types";

const SESSION_KEY = "pm.session";

/**
 * Sessions live in localStorage so a reload keeps the user signed in.
 * Every access is guarded: storage can be unavailable or blocked.
 */
export const loadSession = (): Session | null => {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed?.token !== "string" || typeof parsed?.user?.username !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const storeSession = (session: Session): void => {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A session that cannot be persisted still works for this tab.
  }
};

export const clearStoredSession = (): void => {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
};
