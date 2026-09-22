"use client";

import { useState } from "react";

import * as api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Session } from "@/lib/types";
import { Button, ErrorText, Field, Input } from "@/components/ui";

type Mode = "login" | "register";

export const AuthScreen = ({ onSignedIn }: { onSignedIn: (session: Session) => void }) => {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register({
              username: username.trim(),
              password,
              full_name: fullName.trim(),
              email: email.trim(),
            });
      onSignedIn(session);
    } catch (caught) {
      setError(errorMessage(caught, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  };

  let submitLabel = mode === "login" ? "Sign in" : "Create account";
  if (busy) {
    submitLabel = "Working...";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface)] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[var(--shadow)]">
        <h1 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">
          {mode === "login" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1 mb-6 text-sm text-[var(--gray-text)]">
          {mode === "login"
            ? "Sign in to reach your boards."
            : "Your first board is created for you."}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Username">
            <Input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </Field>

          {mode === "register" ? (
            <>
              <Field label="Full name">
                <Input
                  name="full_name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </Field>
              <Field label="Email">
                <Input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field label="Password">
            <Input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <Button type="submit" disabled={busy}>
            {submitLabel}
          </Button>
        </form>

        <button
          type="button"
          onClick={switchMode}
          className="mt-5 w-full text-sm text-[var(--primary-blue)] hover:underline"
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already registered? Sign in"}
        </button>
      </div>
    </main>
  );
};
