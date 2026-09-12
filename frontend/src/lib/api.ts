import type { BoardData } from "@/lib/kanban";

const API_BASE = "/api";

export type AIHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type AIResponse = {
  reply: string;
  board_update?: BoardData | null;
};

export const fetchBoard = async (username: string): Promise<BoardData> => {
  const response = await fetch(`${API_BASE}/board?user=${encodeURIComponent(username)}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch board for ${username}: ${response.status}`);
  }

  return response.json();
};

export const saveBoard = async (username: string, board: BoardData): Promise<BoardData> => {
  const response = await fetch(`${API_BASE}/board?user=${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(board),
  });

  if (!response.ok) {
    throw new Error(`Failed to save board for ${username}: ${response.status}`);
  }

  return response.json();
};

export const askAI = async (
  username: string,
  board: BoardData,
  question: string,
  history: AIHistoryEntry[] = []
): Promise<AIResponse> => {
  const response = await fetch(`${API_BASE}/ai/board`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user: username,
      board,
      question,
      history,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status}`);
  }

  return response.json();
};
