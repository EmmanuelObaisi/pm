"use client";

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { clearStoredSession, loadSession, storeSession } from "@/lib/session";
import type { Session, User } from "@/lib/types";
import { AccountPanel } from "@/components/AccountPanel";
import { AuthScreen } from "@/components/AuthScreen";
import { BoardList } from "@/components/BoardList";
import { BoardView } from "@/components/BoardView";
import { Button, Spinner } from "@/components/ui";

type View = { name: "boards" } | { name: "board"; boardId: number } | { name: "account" };

export const Workspace = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: "boards" });

  // Restore a stored session, and make sure its token is still good. Becoming
  // ready waits on a promise even when there is nothing stored, because
  // setting state straight from an effect body cascades renders.
  useEffect(() => {
    let cancelled = false;
    const stored = loadSession();
    if (stored) {
      api.setAuthToken(stored.token);
    }

    const restore = stored
      ? api
          .fetchMe()
          .then((user) => {
            if (!cancelled) {
              setSession({ token: stored.token, user });
            }
          })
          .catch(() => {
            api.setAuthToken(null);
            clearStoredSession();
          })
      : Promise.resolve();

    void restore.finally(() => {
      if (!cancelled) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = (next: Session) => {
    api.setAuthToken(next.token);
    storeSession(next);
    setSession(next);
    setView({ name: "boards" });
  };

  const signOut = () => {
    api.setAuthToken(null);
    clearStoredSession();
    setSession(null);
    setView({ name: "boards" });
  };

  const updateUser = (user: User) => {
    setSession((previous) => {
      if (!previous) {
        return previous;
      }
      const next = { ...previous, user };
      storeSession(next);
      return next;
    });
  };

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner label="Starting up" />
      </main>
    );
  }

  if (!session) {
    return <AuthScreen onSignedIn={signIn} />;
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--surface)]">
      <nav className="flex items-center gap-3 border-b border-[var(--stroke)] bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => setView({ name: "boards" })}
          className="font-display text-base font-semibold"
        >
          Kanban Studio
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[var(--gray-text)]">
            {session.user.full_name || session.user.username}
          </span>
          <Button
            variant={view.name === "account" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setView({ name: "account" })}
          >
            Account
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.name === "boards" ? (
          <BoardList onOpen={(boardId) => setView({ name: "board", boardId })} />
        ) : null}

        {view.name === "board" ? (
          <BoardView
            boardId={view.boardId}
            currentUser={session.user}
            onBack={() => setView({ name: "boards" })}
          />
        ) : null}

        {view.name === "account" ? (
          <AccountPanel user={session.user} onUserChange={updateUser} />
        ) : null}
      </div>
    </main>
  );
};
