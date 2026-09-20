import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "@/components/Workspace";
import * as api from "@/lib/api";
import { boardWithCards, makeUser } from "@/test/factories";

vi.mock("@/lib/api");

const user = makeUser({ id: 1, username: "alice", full_name: "Alice Example" });
const session = { token: "tok", user };

const storeSession = () =>
  window.localStorage.setItem("pm.session", JSON.stringify(session));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(api.fetchBoards).mockResolvedValue([]);
});

describe("Workspace startup", () => {
  it("shows the sign-in screen when there is no stored session", async () => {
    render(<Workspace />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(api.fetchMe).not.toHaveBeenCalled();
  });

  it("restores a stored session and revalidates the token", async () => {
    storeSession();
    vi.mocked(api.fetchMe).mockResolvedValue(user);
    render(<Workspace />);

    expect(await screen.findByText("Your boards")).toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenCalledWith("tok");
    expect(api.fetchMe).toHaveBeenCalled();
  });

  it("discards a stored session whose token is rejected", async () => {
    storeSession();
    vi.mocked(api.fetchMe).mockRejectedValue(new Error("Invalid or expired token"));
    render(<Workspace />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenLastCalledWith(null);
    expect(window.localStorage.getItem("pm.session")).toBeNull();
  });

  it("uses the profile the server returns, not the stored copy", async () => {
    storeSession();
    vi.mocked(api.fetchMe).mockResolvedValue(
      makeUser({ id: 1, username: "alice", full_name: "Renamed Since" })
    );
    render(<Workspace />);

    expect(await screen.findByText("Renamed Since")).toBeInTheDocument();
  });
});

describe("Workspace sign in and out", () => {
  it("signs in and stores the session", async () => {
    const person = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue(session);
    render(<Workspace />);

    await person.type(await screen.findByLabelText("Username"), "alice");
    await person.type(screen.getByLabelText("Password"), "password123");
    await person.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Your boards")).toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenCalledWith("tok");
    expect(JSON.parse(window.localStorage.getItem("pm.session") ?? "{}")).toEqual(
      session
    );
  });

  it("signs out and forgets the session", async () => {
    const person = userEvent.setup();
    storeSession();
    vi.mocked(api.fetchMe).mockResolvedValue(user);
    render(<Workspace />);

    await screen.findByText("Your boards");
    await person.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(window.localStorage.getItem("pm.session")).toBeNull();
    expect(api.setAuthToken).toHaveBeenLastCalledWith(null);
  });
});

describe("Workspace navigation", () => {
  const signedIn = async () => {
    storeSession();
    vi.mocked(api.fetchMe).mockResolvedValue(user);
    render(<Workspace />);
    await screen.findByText("Your boards");
  };

  it("opens a board from the list and comes back", async () => {
    const person = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([
      { ...boardWithCards([[]]), id: 5, name: "Roadmap" },
    ]);
    vi.mocked(api.fetchBoard).mockResolvedValue(
      boardWithCards([["Write the spec"], []], { id: 5, name: "Roadmap" })
    );
    vi.mocked(api.fetchComments).mockResolvedValue([]);
    vi.mocked(api.fetchAIMessages).mockResolvedValue([]);
    await signedIn();

    await person.click(screen.getByText("Roadmap"));
    expect(await screen.findByText("Write the spec")).toBeInTheDocument();
    expect(api.fetchBoard).toHaveBeenCalledWith(5);

    await person.click(screen.getByRole("button", { name: "Boards" }));
    expect(await screen.findByText("Your boards")).toBeInTheDocument();
  });

  it("opens the account page and returns to the boards", async () => {
    const person = userEvent.setup();
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([]);
    await signedIn();

    await person.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();

    await person.click(screen.getByRole("button", { name: "Kanban Studio" }));
    expect(await screen.findByText("Your boards")).toBeInTheDocument();
  });

  it("keeps the header profile in step with a profile edit", async () => {
    const person = userEvent.setup();
    vi.mocked(api.updateProfile).mockResolvedValue(
      makeUser({ id: 1, username: "alice", full_name: "Alice Updated" })
    );
    await signedIn();

    await person.click(screen.getByRole("button", { name: "Account" }));
    await person.click(await screen.findByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(screen.getByText("Alice Updated")).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("pm.session") ?? "{}").user.full_name)
      .toBe("Alice Updated");
  });
});
