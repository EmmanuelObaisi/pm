import type {
  ActivityEntry,
  AIMessage,
  AIResult,
  Board,
  BoardStats,
  BoardSummary,
  CardDetail,
  Comment,
  DirectoryUser,
  Member,
  Priority,
  Session,
  User,
} from "@/lib/types";

const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

const readError = async (response: Response) => {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") {
      return body.detail;
    }
    // FastAPI validation errors arrive as a list of issues.
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      return body.detail[0]?.msg ?? "Request failed";
    }
  } catch {
    // Fall through to the generic message below.
  }
  return `Request failed (${response.status})`;
};

const request = async <T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const register = (payload: {
  username: string;
  password: string;
  email?: string;
  full_name?: string;
}) => request<Session>("/auth/register", { method: "POST", body: payload });

export const login = (username: string, password: string) =>
  request<Session>("/auth/login", { method: "POST", body: { username, password } });

export const fetchMe = () => request<User>("/auth/me");

export const updateProfile = (payload: { email?: string; full_name?: string }) =>
  request<User>("/auth/me", { method: "PATCH", body: payload });

export const changePassword = (current_password: string, new_password: string) =>
  request<{ status: string }>("/auth/password", {
    method: "POST",
    body: { current_password, new_password },
  });

export const fetchDirectory = () => request<DirectoryUser[]>("/auth/users");

export const fetchAdminUsers = () => request<User[]>("/admin/users");

export const updateAdminUser = (
  userId: number,
  payload: { is_active?: boolean; is_admin?: boolean }
) => request<User>(`/admin/users/${userId}`, { method: "PATCH", body: payload });

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export const fetchBoards = (includeArchived = false) =>
  request<BoardSummary[]>(`/boards?include_archived=${includeArchived}`);

export const createBoard = (payload: {
  name: string;
  description?: string;
  template?: "kanban" | "empty";
}) => request<Board>("/boards", { method: "POST", body: payload });

export const fetchBoard = (boardId: number, includeArchived = false) =>
  request<Board>(`/boards/${boardId}?include_archived=${includeArchived}`);

export const updateBoard = (
  boardId: number,
  payload: { name?: string; description?: string; archived?: boolean }
) => request<Board>(`/boards/${boardId}`, { method: "PATCH", body: payload });

export const deleteBoard = (boardId: number) =>
  request<void>(`/boards/${boardId}`, { method: "DELETE" });

export const fetchStats = (boardId: number) =>
  request<BoardStats>(`/boards/${boardId}/stats`);

export const fetchActivity = (boardId: number, limit = 50) =>
  request<ActivityEntry[]>(`/boards/${boardId}/activity?limit=${limit}`);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const fetchMembers = (boardId: number) =>
  request<Member[]>(`/boards/${boardId}/members`);

export const addMember = (boardId: number, username: string, role: "editor" | "viewer") =>
  request<Member[]>(`/boards/${boardId}/members`, {
    method: "POST",
    body: { username, role },
  });

export const updateMember = (
  boardId: number,
  userId: number,
  role: "editor" | "viewer"
) =>
  request<Member[]>(`/boards/${boardId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
  });

export const removeMember = (boardId: number, userId: number) =>
  request<Member[]>(`/boards/${boardId}/members/${userId}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Columns and labels
// ---------------------------------------------------------------------------

export const createColumn = (boardId: number, title: string, wip_limit?: number | null) =>
  request<Board>(`/boards/${boardId}/columns`, {
    method: "POST",
    body: { title, wip_limit: wip_limit ?? null },
  });

export const updateColumn = (
  columnId: number,
  payload: { title?: string; wip_limit?: number | null; clear_wip_limit?: boolean }
) => request<Board>(`/columns/${columnId}`, { method: "PATCH", body: payload });

export const deleteColumn = (columnId: number) =>
  request<Board>(`/columns/${columnId}`, { method: "DELETE" });

export const moveColumn = (columnId: number, position: number) =>
  request<Board>(`/columns/${columnId}/move`, { method: "POST", body: { position } });

export const createLabel = (boardId: number, name: string, color: string) =>
  request<Board>(`/boards/${boardId}/labels`, { method: "POST", body: { name, color } });

export const updateLabel = (
  boardId: number,
  labelId: number,
  payload: { name?: string; color?: string }
) =>
  request<Board>(`/boards/${boardId}/labels/${labelId}`, {
    method: "PATCH",
    body: payload,
  });

export const deleteLabel = (boardId: number, labelId: number) =>
  request<Board>(`/boards/${boardId}/labels/${labelId}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type CardCreatePayload = {
  column_id: number;
  title: string;
  details?: string;
  priority?: Priority;
  assignee_id?: number | null;
  due_date?: string | null;
  estimate?: number | null;
  label_ids?: number[];
};

export type CardUpdatePayload = {
  title?: string;
  details?: string;
  priority?: Priority;
  assignee_id?: number | null;
  clear_assignee?: boolean;
  due_date?: string | null;
  clear_due_date?: boolean;
  estimate?: number | null;
  clear_estimate?: boolean;
  archived?: boolean;
  label_ids?: number[];
};

export const createCard = (boardId: number, payload: CardCreatePayload) =>
  request<Board>(`/boards/${boardId}/cards`, { method: "POST", body: payload });

export const fetchCard = (cardId: number) => request<CardDetail>(`/cards/${cardId}`);

export const updateCard = (cardId: number, payload: CardUpdatePayload) =>
  request<Board>(`/cards/${cardId}`, { method: "PATCH", body: payload });

export const deleteCard = (cardId: number) =>
  request<Board>(`/cards/${cardId}`, { method: "DELETE" });

export const moveCard = (cardId: number, column_id: number, position: number) =>
  request<Board>(`/cards/${cardId}/move`, {
    method: "POST",
    body: { column_id, position },
  });

export const addChecklistItem = (cardId: number, text: string) =>
  request<Board>(`/cards/${cardId}/checklist`, { method: "POST", body: { text } });

export const updateChecklistItem = (
  itemId: number,
  payload: { text?: string; done?: boolean }
) => request<Board>(`/checklist/${itemId}`, { method: "PATCH", body: payload });

export const deleteChecklistItem = (itemId: number) =>
  request<Board>(`/checklist/${itemId}`, { method: "DELETE" });

export const fetchComments = (cardId: number) =>
  request<Comment[]>(`/cards/${cardId}/comments`);

export const addComment = (cardId: number, body: string) =>
  request<Comment[]>(`/cards/${cardId}/comments`, { method: "POST", body: { body } });

export const deleteComment = (commentId: number) =>
  request<Comment[]>(`/comments/${commentId}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const askAI = (boardId: number, question: string) =>
  request<AIResult>(`/boards/${boardId}/ai`, { method: "POST", body: { question } });

export const fetchAIMessages = (boardId: number) =>
  request<AIMessage[]>(`/boards/${boardId}/ai/messages`);

export const clearAIMessages = (boardId: number) =>
  request<void>(`/boards/${boardId}/ai/messages`, { method: "DELETE" });
