import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthScreen } from "@/components/AuthScreen";
import * as api from "@/lib/api";
import { makeUser } from "@/test/factories";

vi.mock("@/lib/api");

const session = { token: "tok", user: makeUser({ username: "alice" }) };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AuthScreen", () => {
  it("signs in with the username and password", async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<AuthScreen onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(api.login).toHaveBeenCalledWith("alice", "password123");
    expect(onSignedIn).toHaveBeenCalledWith(session);
  });

  it("trims whitespace around the username", async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue(session);
    render(<AuthScreen onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "  alice  ");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(api.login).toHaveBeenCalledWith("alice", "password123");
  });

  it("shows the reason a sign-in failed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockRejectedValue(
      new Error("Invalid username or password")
    );
    render(<AuthScreen onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password"
    );
  });

  it("switches to registration and collects the extra fields", async () => {
    const user = userEvent.setup();
    vi.mocked(api.register).mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<AuthScreen onSignedIn={onSignedIn} />);

    await user.click(screen.getByRole("button", { name: /Need an account/ }));
    expect(screen.getByRole("heading")).toHaveTextContent("Create an account");

    await user.type(screen.getByLabelText("Username"), "dana");
    await user.type(screen.getByLabelText("Full name"), "Dana Scully");
    await user.type(screen.getByLabelText("Email"), "dana@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(api.register).toHaveBeenCalledWith({
      username: "dana",
      password: "password123",
      full_name: "Dana Scully",
      email: "dana@example.com",
    });
    expect(onSignedIn).toHaveBeenCalledWith(session);
  });

  it("does not show the registration fields in sign-in mode", () => {
    render(<AuthScreen onSignedIn={vi.fn()} />);
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("clears the error when switching mode", async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockRejectedValue(new Error("Nope"));
    render(<AuthScreen onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Need an account/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the submit button while the request is in flight", async () => {
    const user = userEvent.setup();
    let release: (value: typeof session) => void = () => {};
    vi.mocked(api.login).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    render(<AuthScreen onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "Working..." })).toBeDisabled();
    release(session);
  });
});
