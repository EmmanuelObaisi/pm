export type Role = "owner" | "editor" | "viewer";

export type Priority = "low" | "medium" | "high" | "urgent";

export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export type User = {
  id: number;
  username: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

export type Session = {
  token: string;
  user: User;
};

export type DirectoryUser = {
  id: number;
  username: string;
  full_name: string;
};

export type ChecklistItem = {
  id: number;
  text: string;
  done: boolean;
  position: number;
};

export type Comment = {
  id: number;
  card_id: number;
  user_id: number | null;
  username: string;
  body: string;
  created_at: string;
};

export type Card = {
  id: number;
  board_id: number;
  column_id: number;
  title: string;
  details: string;
  position: number;
  priority: Priority;
  assignee_id: number | null;
  assignee_username: string | null;
  due_date: string | null;
  estimate: number | null;
  archived: boolean;
  label_ids: number[];
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
};

export type CardDetail = Card & { comments: Comment[] };

export type Column = {
  id: number;
  title: string;
  position: number;
  wip_limit: number | null;
  card_ids: number[];
};

export type Label = {
  id: number;
  name: string;
  color: string;
};

export type Member = {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  role: Role;
  created_at: string;
};

export type BoardStats = {
  total_cards: number;
  active_cards: number;
  archived_cards: number;
  overdue_cards: number;
  total_estimate: number;
  cards_by_column: Record<string, number>;
  cards_by_priority: Record<string, number>;
  cards_by_assignee: Record<string, number>;
};

export type BoardSummary = {
  id: number;
  name: string;
  description: string;
  archived: boolean;
  owner_id: number;
  owner_username: string;
  role: Role;
  created_at: string;
  updated_at: string;
  stats: BoardStats;
};

export type Board = BoardSummary & {
  columns: Column[];
  cards: Card[];
  labels: Label[];
  members: Member[];
};

export type ActivityEntry = {
  id: number;
  action: string;
  summary: string;
  username: string;
  created_at: string;
};

export type AIMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AIResult = {
  reply: string;
  applied: string[];
  errors: string[];
  board: Board;
};
