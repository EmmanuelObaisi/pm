import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPanel } from "@/components/AccountPanel";
import * as api from "@/lib/api";
import { makeUser } from "@/test/factories";

vi.mock("@/lib/api");

const alice = makeUser({
  id: 1,
  username: "alice",
  full_name: "Alice Example",
  email: "alice@example.com",
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("profile", () => {
  it("shows the current profile with the username locked", () => {
    render(<AccountPanel user={alice} onUserChange={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toHaveValue("alice");
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Full name")).toHaveValue("Alice Example");
    expect(screen.getByLabelText("Email")).toHaveValue("alice@example.com");
  });

  it("saves the profile and reports success", async () => {
    const user = userEvent.setup();
    const updated = makeUser({ id: 1, username: "alice", full_name: "Alice Updated" });
    vi.mocked(api.updateProfile).mockResolvedValue(updated);
    const onUserChange = vi.fn();
    render(<AccountPanel user={alice} onUserChange={onUserChange} />);

    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Alice Updated");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(api.updateProfile).toHaveBeenCalledWith({
      full_name: "Alice Updated",
      email: "alice@example.com",
    });
    expect(onUserChange).toHaveBeenCalledWith(updated);
    expect(await screen.findByText("Profile saved")).toBeInTheDocument();
  });

  it("reports a failed profile save", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockRejectedValue(new Error("Not authenticated"));
    render(<AccountPanel user={alice} onUserChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authenticated");
  });

  it("changes the password and clears the fields", async () => {
    const user = userEvent.setup();
    vi.mocked(api.changePassword).mockResolvedValue({ status: "updated" });
    render(<AccountPanel user={alice} onUserChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Current password"), "password123");
    await user.type(screen.getByLabelText("New password"), "brandnew123");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(api.changePassword).toHaveBeenCalledWith("password123", "brandnew123");
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("reports a wrong current password", async () => {
    const user = userEvent.setup();
    vi.mocked(api.changePassword).mockRejectedValue(
      new Error("Current password is incorrect")
    );
    render(<AccountPanel user={alice} onUserChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Current password"), "wrong");
    await user.type(screen.getByLabelText("New password"), "brandnew123");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect"
    );
  });
});

describe("administration", () => {
  const admin = makeUser({ id: 1, username: "alice", is_admin: true });
  const bob = makeUser({ id: 2, username: "bob", email: "bob@example.com" });

  it("is hidden from a non-admin", () => {
    render(<AccountPanel user={alice} onUserChange={vi.fn()} />);
    expect(screen.queryByText("User administration")).not.toBeInTheDocument();
    expect(api.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it("lists every account for an admin", async () => {
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([admin, bob]);
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);

    expect(await screen.findByText("User administration")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2);
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("offers no controls against the admin's own row", async () => {
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([admin]);
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);

    await screen.findByText("User administration");
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /admin/ })).not.toBeInTheDocument();
  });

  it("deactivates and reactivates another user", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([admin, bob]);
    vi.mocked(api.updateAdminUser).mockResolvedValue({ ...bob, is_active: false });
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(api.updateAdminUser).toHaveBeenCalledWith(2, { is_active: false });
    expect(await screen.findByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.getByText("deactivated")).toBeInTheDocument();
  });

  it("promotes another user to admin", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([admin, bob]);
    vi.mocked(api.updateAdminUser).mockResolvedValue({ ...bob, is_admin: true });
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Make admin" }));
    expect(api.updateAdminUser).toHaveBeenCalledWith(2, { is_admin: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Revoke admin" })).toBeInTheDocument()
    );
  });

  it("reports a failed administrative change", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([admin, bob]);
    vi.mocked(api.updateAdminUser).mockRejectedValue(new Error("User not found"));
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
  });

  it("reports a failure to load the user list", async () => {
    vi.mocked(api.fetchAdminUsers).mockRejectedValue(new Error("Admin access required"));
    render(<AccountPanel user={admin} onUserChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Admin access required");
  });
});
