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

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const register = (payload: {
  username: string;
  password: string;
  email?: string;
  full_name?: string;
}) => post<Session>("/auth/register", payload);

export const login = (username: string, password: string) =>
  post<Session>("/auth/login", { username, password });

export const fetchMe = () => get<User>("/auth/me");

export const updateProfile = (payload: { email?: string; full_name?: string }) =>
  patch<User>("/auth/me", payload);

export const changePassword = (current_password: string, new_password: string) =>
  post<{ status: string }>("/auth/password", { current_password, new_password });

export const fetchDirectory = () => get<DirectoryUser[]>("/auth/users");

export const fetchAdminUsers = () => get<User[]>("/admin/users");

export const updateAdminUser = (
  userId: number,
  payload: { is_active?: boolean; is_admin?: boolean }
) => patch<User>(`/admin/users/${userId}`, payload);

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export const fetchBoards = (includeArchived = false) =>
  get<BoardSummary[]>(`/boards?include_archived=${includeArchived}`);

export const createBoard = (payload: {
  name: string;
  description?: string;
  template?: "kanban" | "empty";
}) => post<Board>("/boards", payload);

export const fetchBoard = (boardId: number, includeArchived = false) =>
  get<Board>(`/boards/${boardId}?include_archived=${includeArchived}`);

export const updateBoard = (
  boardId: number,
  payload: { name?: string; description?: string; archived?: boolean }
) => patch<Board>(`/boards/${boardId}`, payload);

export const deleteBoard = (boardId: number) => del<void>(`/boards/${boardId}`);

export const fetchStats = (boardId: number) => get<BoardStats>(`/boards/${boardId}/stats`);

export const fetchActivity = (boardId: number, limit = 50) =>
  get<ActivityEntry[]>(`/boards/${boardId}/activity?limit=${limit}`);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const fetchMembers = (boardId: number) =>
  get<Member[]>(`/boards/${boardId}/members`);

export const addMember = (boardId: number, username: string, role: "editor" | "viewer") =>
  post<Member[]>(`/boards/${boardId}/members`, { username, role });

export const updateMember = (
  boardId: number,
  userId: number,
  role: "editor" | "viewer"
) => patch<Member[]>(`/boards/${boardId}/members/${userId}`, { role });

export const removeMember = (boardId: number, userId: number) =>
  del<Member[]>(`/boards/${boardId}/members/${userId}`);

// ---------------------------------------------------------------------------
// Columns and labels
// ---------------------------------------------------------------------------

export const createColumn = (boardId: number, title: string, wip_limit?: number | null) =>
  post<Board>(`/boards/${boardId}/columns`, { title, wip_limit: wip_limit ?? null });

export const updateColumn = (
  columnId: number,
  payload: { title?: string; wip_limit?: number | null; clear_wip_limit?: boolean }
) => patch<Board>(`/columns/${columnId}`, payload);

export const deleteColumn = (columnId: number) => del<Board>(`/columns/${columnId}`);

export const moveColumn = (columnId: number, position: number) =>
  post<Board>(`/columns/${columnId}/move`, { position });

export const createLabel = (boardId: number, name: string, color: string) =>
  post<Board>(`/boards/${boardId}/labels`, { name, color });

export const updateLabel = (
  boardId: number,
  labelId: number,
  payload: { name?: string; color?: string }
) => patch<Board>(`/boards/${boardId}/labels/${labelId}`, payload);

export const deleteLabel = (boardId: number, labelId: number) =>
  del<Board>(`/boards/${boardId}/labels/${labelId}`);

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
  post<Board>(`/boards/${boardId}/cards`, payload);

export const fetchCard = (cardId: number) => get<CardDetail>(`/cards/${cardId}`);

export const updateCard = (cardId: number, payload: CardUpdatePayload) =>
  patch<Board>(`/cards/${cardId}`, payload);

export const deleteCard = (cardId: number) => del<Board>(`/cards/${cardId}`);

export const moveCard = (cardId: number, column_id: number, position: number) =>
  post<Board>(`/cards/${cardId}/move`, { column_id, position });

export const addChecklistItem = (cardId: number, text: string) =>
  post<Board>(`/cards/${cardId}/checklist`, { text });

export const updateChecklistItem = (
  itemId: number,
  payload: { text?: string; done?: boolean }
) => patch<Board>(`/checklist/${itemId}`, payload);

export const deleteChecklistItem = (itemId: number) => del<Board>(`/checklist/${itemId}`);

export const fetchComments = (cardId: number) =>
  get<Comment[]>(`/cards/${cardId}/comments`);

export const addComment = (cardId: number, body: string) =>
  post<Comment[]>(`/cards/${cardId}/comments`, { body });

export const deleteComment = (commentId: number) =>
  del<Comment[]>(`/comments/${commentId}`);

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const askAI = (boardId: number, question: string) =>
  post<AIResult>(`/boards/${boardId}/ai`, { question });

export const fetchAIMessages = (boardId: number) =>
  get<AIMessage[]>(`/boards/${boardId}/ai/messages`);

export const clearAIMessages = (boardId: number) =>
  del<void>(`/boards/${boardId}/ai/messages`);
