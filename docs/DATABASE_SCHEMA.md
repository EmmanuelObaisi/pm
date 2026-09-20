# Database approach

## Overview

SQLite, at `backend/project_management.db`, created on first use. The path can
be overridden with the `PM_DB_PATH` environment variable; the e2e suite uses
that to run against a throwaway file.

The schema is defined in `backend/app/db.py` and applied with
`CREATE TABLE IF NOT EXISTS`, so opening an existing database is safe.
`PRAGMA foreign_keys = ON` is set on every connection, so the `ON DELETE`
rules below are enforced: deleting a board removes its columns, cards,
labels, members, activity, and AI messages.

## Migration from the MVP schema

The MVP stored one board per user as a single `boards.board_json` blob. On
first open, `migrate_legacy_schema` detects that column, reads the old rows,
rebuilds the tables, and reinserts the data in normalized form, preserving
column and card order. Migrated accounts had no stored password, so they get
the MVP's `password` and can sign in unchanged. The migration runs once: after
it, `board_json` no longer exists, so the check is false on later opens.

## Schema

### users

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- username: TEXT NOT NULL UNIQUE COLLATE NOCASE
- email: TEXT NOT NULL DEFAULT ''
- full_name: TEXT NOT NULL DEFAULT ''
- password_hash: TEXT NOT NULL — `pbkdf2_sha256$<rounds>$<salt>$<digest>`
- is_admin: INTEGER NOT NULL DEFAULT 0
- is_active: INTEGER NOT NULL DEFAULT 1
- created_at: TEXT NOT NULL

### boards

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- name: TEXT NOT NULL
- description: TEXT NOT NULL DEFAULT ''
- owner_id: INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
- archived: INTEGER NOT NULL DEFAULT 0
- created_at, updated_at: TEXT NOT NULL

### board_members

Who can reach a board, and as what. The owner has a row here too.

- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- user_id: INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
- role: TEXT NOT NULL — `owner`, `editor`, or `viewer`
- created_at: TEXT NOT NULL
- PRIMARY KEY (board_id, user_id)

### board_columns

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- title: TEXT NOT NULL
- position: INTEGER NOT NULL — 0-based, kept contiguous
- wip_limit: INTEGER — null for no limit

### labels

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- name: TEXT NOT NULL
- color: TEXT NOT NULL

### cards

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- column_id: INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE
- title: TEXT NOT NULL
- details: TEXT NOT NULL DEFAULT ''
- position: INTEGER NOT NULL — 0-based within the column, over unarchived cards
- priority: TEXT NOT NULL DEFAULT 'medium' — low, medium, high, urgent
- assignee_id: INTEGER REFERENCES users(id) ON DELETE SET NULL
- due_date: TEXT — `YYYY-MM-DD`
- estimate: REAL — hours
- archived: INTEGER NOT NULL DEFAULT 0
- created_by: INTEGER REFERENCES users(id) ON DELETE SET NULL
- created_at, updated_at: TEXT NOT NULL

Archiving a card takes it out of its column's ordering; positions are
renumbered so the remaining cards stay contiguous.

### card_labels

- card_id: INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE
- label_id: INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE
- PRIMARY KEY (card_id, label_id)

### checklist_items

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- card_id: INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE
- text: TEXT NOT NULL
- done: INTEGER NOT NULL DEFAULT 0
- position: INTEGER NOT NULL

### comments

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- card_id: INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE
- user_id: INTEGER REFERENCES users(id) ON DELETE SET NULL
- body: TEXT NOT NULL
- created_at: TEXT NOT NULL

### activity

Append-only feed, read newest first.

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- user_id: INTEGER REFERENCES users(id) ON DELETE SET NULL
- action: TEXT NOT NULL — `card.create`, `card.move`, `ai.operation`, ...
- summary: TEXT NOT NULL
- created_at: TEXT NOT NULL

### ai_messages

The assistant's conversation, one thread per board.

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- board_id: INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE
- user_id: INTEGER REFERENCES users(id) ON DELETE SET NULL
- role: TEXT NOT NULL — `user` or `assistant`
- content: TEXT NOT NULL
- created_at: TEXT NOT NULL

## Indexes

- idx_cards_board (board_id)
- idx_cards_column (column_id, position)
- idx_columns_board (board_id, position)
- idx_activity_board (board_id, id)
- idx_ai_messages_board (board_id, id)
