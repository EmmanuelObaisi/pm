"""Request and response models for the API."""

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["owner", "editor", "viewer"]
Priority = Literal["low", "medium", "high", "urgent"]

PRIORITIES = ("low", "medium", "high", "urgent")
ROLES = ("owner", "editor", "viewer")


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=200)
    email: str = ""
    full_name: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class ProfileUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=200)


class AdminUserUpdate(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None


class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    template: Literal["kanban", "empty"] = "kanban"


class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    archived: bool | None = None


class MemberAdd(BaseModel):
    username: str
    role: Literal["editor", "viewer"] = "editor"


class MemberUpdate(BaseModel):
    role: Literal["editor", "viewer"]


class ColumnCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    wip_limit: int | None = Field(default=None, ge=1)


class ColumnUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    wip_limit: int | None = Field(default=None, ge=1)
    clear_wip_limit: bool = False


class ColumnMove(BaseModel):
    position: int = Field(ge=0)


class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = "#64748b"


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    color: str | None = None


class CardCreate(BaseModel):
    column_id: int
    title: str = Field(min_length=1, max_length=200)
    details: str = ""
    priority: Priority = "medium"
    assignee_id: int | None = None
    due_date: str | None = None
    estimate: float | None = Field(default=None, ge=0)
    label_ids: list[int] = Field(default_factory=list)


class CardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = None
    priority: Priority | None = None
    assignee_id: int | None = None
    clear_assignee: bool = False
    due_date: str | None = None
    clear_due_date: bool = False
    estimate: float | None = Field(default=None, ge=0)
    clear_estimate: bool = False
    archived: bool | None = None
    label_ids: list[int] | None = None


class CardMove(BaseModel):
    column_id: int
    position: int = Field(ge=0)


class ChecklistItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200)


class ChecklistItemUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class AIRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
