import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
};

beforeEach(() => {
  // A Response body can only be read once, so build a fresh one per call.
  fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  api.setAuthToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request plumbing", () => {
  it("sends a GET with no body or content type", async () => {
    await api.fetchBoards();
    const { url, init } = lastCall();
    expect(url).toBe("/api/boards?include_archived=false");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("serializes a JSON body", async () => {
    await api.createBoard({ name: "Roadmap", template: "empty" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/boards");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Roadmap",
      template: "empty",
    });
  });

  it("omits the Authorization header until a token is set", async () => {
    await api.fetchBoards();
    expect(lastCall().init.headers).not.toHaveProperty("Authorization");

    api.setAuthToken("abc123");
    await api.fetchBoards();
    expect(lastCall().init.headers).toMatchObject({ Authorization: "Bearer abc123" });
  });

  it("remembers and clears the token", () => {
    api.setAuthToken("abc123");
    expect(api.getAuthToken()).toBe("abc123");
    api.setAuthToken(null);
    expect(api.getAuthToken()).toBeNull();
  });

  it("returns undefined for a 204 instead of parsing a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.clearAIMessages(1)).resolves.toBeUndefined();
  });
});

describe("error handling", () => {
  it("raises ApiError carrying the status and detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Board not found" }, 404));
    await expect(api.fetchBoard(9)).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Board not found",
    });
  });

  it("reads the first message out of a validation error list", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: [{ msg: "String should have at least 6 characters" }] }, 422)
    );
    await expect(api.register({ username: "x", password: "y" })).rejects.toThrow(
      "String should have at least 6 characters"
    );
  });

  it("falls back to the status when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("gateway down", { status: 502 }));
    await expect(api.fetchBoards()).rejects.toThrow("Request failed (502)");
  });

  it("falls back when the error body has no usable detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: [] }, 500));
    await expect(api.fetchBoards()).rejects.toThrow("Request failed (500)");
  });

  it("is an instance of ApiError so callers can check the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 401));
    await expect(api.fetchMe()).rejects.toBeInstanceOf(api.ApiError);
  });
});

describe("endpoints", () => {
  const cases: Array<[string, () => Promise<unknown>, string, string]> = [
    ["login", () => api.login("alice", "pw"), "/api/auth/login", "POST"],
    ["fetchMe", () => api.fetchMe(), "/api/auth/me", "GET"],
    ["updateProfile", () => api.updateProfile({ email: "a@b.c" }), "/api/auth/me", "PATCH"],
    [
      "changePassword",
      () => api.changePassword("old", "new"),
      "/api/auth/password",
      "POST",
    ],
    ["fetchDirectory", () => api.fetchDirectory(), "/api/auth/users", "GET"],
    ["fetchAdminUsers", () => api.fetchAdminUsers(), "/api/admin/users", "GET"],
    [
      "updateAdminUser",
      () => api.updateAdminUser(3, { is_active: false }),
      "/api/admin/users/3",
      "PATCH",
    ],
    ["fetchBoard", () => api.fetchBoard(2), "/api/boards/2?include_archived=false", "GET"],
    ["updateBoard", () => api.updateBoard(2, { name: "New" }), "/api/boards/2", "PATCH"],
    ["deleteBoard", () => api.deleteBoard(2), "/api/boards/2", "DELETE"],
    ["fetchStats", () => api.fetchStats(2), "/api/boards/2/stats", "GET"],
    ["fetchActivity", () => api.fetchActivity(2, 10), "/api/boards/2/activity?limit=10", "GET"],
    ["fetchMembers", () => api.fetchMembers(2), "/api/boards/2/members", "GET"],
    ["addMember", () => api.addMember(2, "bob", "editor"), "/api/boards/2/members", "POST"],
    [
      "updateMember",
      () => api.updateMember(2, 5, "viewer"),
      "/api/boards/2/members/5",
      "PATCH",
    ],
    ["removeMember", () => api.removeMember(2, 5), "/api/boards/2/members/5", "DELETE"],
    ["createColumn", () => api.createColumn(2, "Blocked"), "/api/boards/2/columns", "POST"],
    ["updateColumn", () => api.updateColumn(4, { title: "X" }), "/api/columns/4", "PATCH"],
    ["deleteColumn", () => api.deleteColumn(4), "/api/columns/4", "DELETE"],
    ["moveColumn", () => api.moveColumn(4, 1), "/api/columns/4/move", "POST"],
    ["createLabel", () => api.createLabel(2, "Bug", "#f00"), "/api/boards/2/labels", "POST"],
    [
      "updateLabel",
      () => api.updateLabel(2, 9, { name: "Defect" }),
      "/api/boards/2/labels/9",
      "PATCH",
    ],
    ["deleteLabel", () => api.deleteLabel(2, 9), "/api/boards/2/labels/9", "DELETE"],
    [
      "createCard",
      () => api.createCard(2, { column_id: 1, title: "Task" }),
      "/api/boards/2/cards",
      "POST",
    ],
    ["fetchCard", () => api.fetchCard(7), "/api/cards/7", "GET"],
    ["updateCard", () => api.updateCard(7, { title: "T" }), "/api/cards/7", "PATCH"],
    ["deleteCard", () => api.deleteCard(7), "/api/cards/7", "DELETE"],
    ["moveCard", () => api.moveCard(7, 2, 0), "/api/cards/7/move", "POST"],
    [
      "addChecklistItem",
      () => api.addChecklistItem(7, "Step"),
      "/api/cards/7/checklist",
      "POST",
    ],
    [
      "updateChecklistItem",
      () => api.updateChecklistItem(8, { done: true }),
      "/api/checklist/8",
      "PATCH",
    ],
    ["deleteChecklistItem", () => api.deleteChecklistItem(8), "/api/checklist/8", "DELETE"],
    ["fetchComments", () => api.fetchComments(7), "/api/cards/7/comments", "GET"],
    ["addComment", () => api.addComment(7, "Hi"), "/api/cards/7/comments", "POST"],
    ["deleteComment", () => api.deleteComment(9), "/api/comments/9", "DELETE"],
    ["askAI", () => api.askAI(2, "What is due?"), "/api/boards/2/ai", "POST"],
    ["fetchAIMessages", () => api.fetchAIMessages(2), "/api/boards/2/ai/messages", "GET"],
  ];

  it.each(cases)("%s calls %s", async (_name, call, url, method) => {
    await call();
    expect(lastCall().url).toBe(url);
    expect(lastCall().init.method).toBe(method);
  });

  it("asks for archived boards when requested", async () => {
    await api.fetchBoards(true);
    expect(lastCall().url).toBe("/api/boards?include_archived=true");
  });

  it("sends a null wip limit when none is given", async () => {
    await api.createColumn(2, "Blocked");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      title: "Blocked",
      wip_limit: null,
    });
  });
});
