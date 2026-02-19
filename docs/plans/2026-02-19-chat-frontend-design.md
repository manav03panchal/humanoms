# HumanOMS Chat Frontend Design

**Date**: 2026-02-19
**Status**: Approved
**Author**: Design session — Manav + Claude

---

## 1. Summary

Replace the CRUD dashboard with a single full-screen chat interface. The user talks to Claude, which has access to all HumanOMS tools (tasks, workflows, entities, jobs, files). Claude streams responses via SSE with rich cards for structured data.

No API key needed for LLM — uses Claude Agent SDK with Max subscription.

## 2. Decisions

- Chat **replaces** the dashboard (not a tab alongside it)
- Chat handles **everything** — tasks, workflows, entities, jobs, approvals, status checks
- Backend uses **Claude Agent SDK** `query()` with HumanOMS tools
- Responses **stream** via SSE (token-by-token + tool results)

## 3. Backend

### 3.1 New endpoint: `POST /api/v1/chat`

**Request:**
```json
{
  "message": "create a recurring workflow that summarizes DDIA chapters",
  "conversation_id": "01JXYZ..."
}
```

**Response:** `text/event-stream`

```
event: conversation_id
data: "01JXYZ..."

event: text
data: "I'll create that workflow..."

event: tool_call
data: {"tool": "create_workflow", "input": {...}}

event: tool_result
data: {"type": "workflow", "data": {"id": "01ABC...", "name": "ddia-summarize"}}

event: text
data: "Done! Created **ddia-summarize** with 3 steps."

event: done
data: {}
```

### 3.2 Agent session

Each message spawns a `query()` call:
1. Load last ~50 messages from `chat_messages` for conversation context
2. Build system prompt with current HumanOMS state (counts, recent activity)
3. Run `query()` with all HumanOMS tools registered
4. Stream SDK messages to client as SSE events
5. Save user + assistant messages to `chat_messages`

System prompt includes:
- What HumanOMS is and what the user can do
- Current state (task count, active jobs, recent workflows)
- Instructions to return structured data that the frontend renders as cards

### 3.3 Tool definitions

Reuse the same operations from executor.ts, wrapped as Claude SDK tool definitions:

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks with optional filters (status, tags, due_before) |
| `create_task` | Create a new task |
| `get_task` | Get task by ID |
| `update_task` | Update task fields |
| `complete_task` | Mark task complete |
| `list_entities` | List entities with filters |
| `create_entity` | Create entity |
| `search_entities` | Full-text search entities |
| `create_workflow` | Create a multi-step workflow |
| `list_workflows` | List all workflows |
| `trigger_workflow` | Trigger a workflow, returns job |
| `list_jobs` | List jobs with filters |
| `get_job` | Get job details + output |
| `list_files` | List registered files |
| `read_file` | Read local file content |
| `web_fetch` | Fetch URL content |
| `system_status` | System health + counts |
| `create_automation` | Create cron-scheduled automation |
| `list_automations` | List automations |

### 3.4 Conversation persistence

New table: `chat_messages`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| conversation_id | TEXT NOT NULL | Groups messages into conversations |
| role | TEXT NOT NULL | "user" or "assistant" |
| content | TEXT NOT NULL | Message text (markdown for assistant) |
| tool_calls | TEXT | JSON array of tool calls made, nullable |
| created_at | TEXT | ISO 8601 |

Index on `conversation_id, created_at`.

## 4. Frontend

### 4.1 Layout

Full-screen chat. No sidebar, no CRUD forms.

```
+--------------------------------------------------+
|  HumanOMS                        [New Chat] [⚙]  |
+--------------------------------------------------+
|                                                   |
|  (assistant) Welcome! I can help you manage...    |
|                                                   |
|  (user) Show my pending tasks                     |
|                                                   |
|  (assistant) Here are your 5 pending tasks:       |
|  +---------------------------------------------+ |
|  | ☐ Read DDIA Ch. 3    | due: Feb 20 | P2     | |
|  | ☐ Review PR #42      | due: Feb 19 | P3     | |
|  +---------------------------------------------+ |
|                                                   |
|  (user) Create a workflow to summarize DDIA...    |
|                                                   |
|  (assistant) [tool: create_workflow ▾]            |
|  Done! Created workflow **ddia-summarize**:       |
|  +---------------------------------------------+ |
|  | Workflow: ddia-summarize                     | |
|  | Steps: read_file → llm_generate → push_git  | |
|  | [Trigger Now]                                | |
|  +---------------------------------------------+ |
|                                                   |
+--------------------------------------------------+
|  [Type a message...]                    [Send ➤]  |
+--------------------------------------------------+
```

### 4.2 Components

- **Chat message list** — scrollable, auto-scrolls on new messages
- **Message bubbles** — markdown-rendered (assistant) or plain text (user)
- **Rich cards** — for tasks, workflows, jobs, entities (rendered from tool_result events)
- **Tool call blocks** — collapsible, show what Claude did ("Called create_workflow with...")
- **Streaming indicator** — blinking cursor while Claude is generating
- **Input bar** — textarea with send button, Enter to send, Shift+Enter for newline
- **Login gate** — same as current (API key auth)

### 4.3 Rich cards

Cards are rendered when the SSE stream emits a `tool_result` event. Card type is determined by the `type` field:

- **Task card**: title, status badge, priority, due date, action buttons (complete, edit)
- **Workflow card**: name, step count, step names, trigger button
- **Job card**: status badge, workflow name, progress (step X/Y), output preview
- **Entity card**: type badge, name, properties preview
- **File card**: name, path, mime type

### 4.4 Tech stack

Same as existing: Preact + HTM from CDN, no build step. New components in `web/components/`.

## 5. Files to create/modify

| File | Action | Description |
|------|--------|-------------|
| `src/api/routes/chat.ts` | Create | SSE chat endpoint + Claude SDK agent session |
| `src/chat/tools.ts` | Create | Tool definitions for Claude SDK (wrapping DB operations) |
| `src/chat/system-prompt.ts` | Create | Dynamic system prompt builder |
| `src/db/schema.ts` | Edit | Add `chat_messages` table |
| `src/api/server.ts` | Edit | Mount chat route |
| `web/app.js` | Rewrite | Chat UI replaces CRUD dashboard |
| `web/components/chat.js` | Create | Message list + input + streaming |
| `web/components/cards.js` | Create | Rich cards for structured data |
| `web/index.html` | Edit | Update styles for chat layout |

## 6. Data flow

```
User types message
  → POST /api/v1/chat (SSE response)
    → Save user message to chat_messages
    → Load conversation history (last 50 messages)
    → Build system prompt with current HumanOMS state
    → query() from Claude Agent SDK with tools
    → For each SDK message:
        text chunk → SSE "text" event
        tool call → execute against DB → SSE "tool_call" + "tool_result"
        result → SSE "done"
    → Save assistant response + tool calls to chat_messages
  ← Frontend renders streamed markdown + rich cards
```
