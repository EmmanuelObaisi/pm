"use client";

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { User } from "@/lib/types";
import { Button, ErrorText, Field, Input, Spinner } from "@/components/ui";

const Profile = ({
  user,
  onUserChange,
}: {
  user: User;
  onUserChange: (user: User) => void;
}) => {
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onUserChange(await api.updateProfile({ full_name: fullName, email }));
      setStatus("Profile saved");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught, "Could not save the profile"));
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setStatus("Password changed");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught, "Could not change the password"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={saveProfile} className="flex max-w-sm flex-col gap-4">
        <h2 className="font-display text-base font-semibold">Profile</h2>
        <Field label="Username">
          <Input value={user.username} disabled />
        </Field>
        <Field label="Full name">
          <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Button type="submit">Save profile</Button>
      </form>

      <form onSubmit={savePassword} className="flex max-w-sm flex-col gap-4">
        <h2 className="font-display text-base font-semibold">Change password</h2>
        <Field label="Current password">
          <Input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
          />
        </Field>
        <Button type="submit">Change password</Button>
      </form>

      <ErrorText>{error}</ErrorText>
      {status ? <p className="text-sm text-green-700">{status}</p> : null}
    </div>
  );
};

const Admin = ({ currentUser }: { currentUser: User }) => {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .fetchAdminUsers()
      .then(setUsers)
      .catch((caught) => {
        setError(errorMessage(caught, "Could not load users"));
        setUsers([]);
      });
  }, []);

  const update = async (userId: number, payload: { is_active?: boolean; is_admin?: boolean }) => {
    try {
      const updated = await api.updateAdminUser(userId, payload);
      setUsers((previous) =>
        (previous ?? []).map((user) => (user.id === updated.id ? updated : user))
      );
      setError("");
    } catch (caught) {
      setError(errorMessage(caught, "Could not update that user"));
    }
  };

  if (users === null) {
    return <Spinner label="Loading users" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-base font-semibold">User administration</h2>
      <ErrorText>{error}</ErrorText>
      <table className="w-full max-w-2xl text-left text-sm">
        <thead className="text-xs text-[var(--gray-text)]">
          <tr>
            <th className="py-2">User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-[var(--stroke)]">
              <td className="py-2">
                {user.username}
                {user.id === currentUser.id ? (
                  <span className="text-xs text-[var(--gray-text)]"> (you)</span>
                ) : null}
              </td>
              <td>{user.email || "-"}</td>
              <td>{user.is_admin ? "admin" : "member"}</td>
              <td>{user.is_active ? "active" : "deactivated"}</td>
              <td className="py-2 text-right">
                {user.id === currentUser.id ? null : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => update(user.id, { is_admin: !user.is_admin })}
                    >
                      {user.is_admin ? "Revoke admin" : "Make admin"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => update(user.id, { is_active: !user.is_active })}
                    >
                      {user.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const AccountPanel = ({
  user,
  onUserChange,
}: {
  user: User;
  onUserChange: (user: User) => void;
}) => (
  <section className="mx-auto w-full max-w-4xl px-6 py-10">
    <h1 className="font-display mb-6 text-2xl font-semibold">Account</h1>
    <Profile user={user} onUserChange={onUserChange} />
    {user.is_admin ? (
      <div className="mt-10 border-t border-[var(--stroke)] pt-8">
        <Admin currentUser={user} />
      </div>
    ) : null}
  </section>
);
