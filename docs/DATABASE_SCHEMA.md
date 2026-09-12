# Database approach

## Overview

The MVP uses SQLite for local persistence in the project root as `project_management.db`.

This keeps the app simple to run locally in Docker while still supporting per-user board storage for future growth.

## Schema

### users

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- username: TEXT NOT NULL UNIQUE

### boards

- id: INTEGER PRIMARY KEY AUTOINCREMENT
- user_id: INTEGER NOT NULL UNIQUE
- board_json: TEXT NOT NULL

The `board_json` column stores the full Kanban board payload as JSON. This includes:

- `columns`: array of column objects
  - `id`
  - `title`
  - `cardIds`
- `cards`: object keyed by card id
  - `id`
  - `title`
  - `details`

## Why this fits the MVP

- Single local database file
- Easy to create automatically if it does not exist
- Keeps one board per user, which matches the MVP limit
- Supports future expansion to more board tables, user metadata, and audit fields

## Example serialized board

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1"] },
    { "id": "col-done", "title": "Done", "cardIds": [] }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Ship plan",
      "details": "Finalize draft for release"
    }
  }
}
```
