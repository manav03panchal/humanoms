# HumanOMS Design Document

**Date**: 2026-02-19
**Status**: Draft
**Author**: Design session — Manav + Claude

---

## 1. Vision

HumanOMS is a local-first personal AI task orchestration platform. It is the single system that manages your life — tasks, knowledge, files, logistics — and lets AI agents act on your behalf with explicit human approval gates.

You drop things in. Define what should happen. The system chains MCP tools to do the work asynchronously. It pings you on Discord for approval when actions have real consequences, and notifies you when work is done.

It is not a todo app. It is not a notes app. It is the operating system for your life, with AI as the execution layer and you as the decision-maker.

## 2. Core Principles

1. **Local-first** — your data lives on your machine, not in someone else's cloud
2. **Security is paramount** — encrypted secrets, audit trails, sandboxed execution, no silent actions
3. **Human-in-the-loop** — destructive or public actions require your explicit approval
4. **AI-native** — MCP server for agents, REST for everything else
5. **Composable** — workflows chain MCP tools like Unix pipes; new tools plug in without code changes
6. **Fail safe, not fail open** — timeouts expire jobs, never auto-approve

## 3. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Fast, batteries-included (SQLite built in), TS-native |
| HTTP | Hono | Lightweight, Bun-optimized, minimal overhead |
| Database | SQLite via `bun:sqlite` | Zero external deps, local-first, single-file DB |
| MCP SDK | `@modelcontextprotocol/sdk` | Official Anthropic SDK for MCP server + client |
| Scheduler | `croner` | Zero-dep cron library, works natively with Bun |
| Validation | Zod | Runtime type validation for all inputs |
| IDs | ULID | Sortable, unique, no coordination needed |
| LLM | `@anthropic-ai/claude-code` | Claude Code SDK — uses Max subscription, no API key needed |

### External MCP Tools

| Need | Package | Cost |
|------|---------|------|
| PDF parsing | `@sylphlab/pdf-reader-mcp` | Free (local) |
| Web search (default) | `@modelcontextprotocol/server-brave-search` | Free (2k queries/mo) |
| Web search (deep) | `exa-mcp-server` | Paid (~$5/1k searches) |
| Discord | `mcp-discord` | Free (bidirectional bot) |
| GitHub | `@modelcontextprotocol/server-github` | Free |

### Smart Search Routing

Brave handles routine lookups (free tier). Exa handles semantic/research queries. The router checks for signals like "research", "paper", "similar to", "in-depth" and routes to Exa; everything else goes to Brave. Users can force either via a parameter.

## 4. Architecture

```
                    +---------------------------------------+
                    |            HumanOMS Core              |
                    |                                       |
  You / Agent ----->  REST API (Hono)  <--->  SQLite DB    |
                    |       +                               |
  AI Agents ------->  MCP Server       <--->  Job Queue    |
                    |       +                               |
                    |  Scheduler (croner)  --->  Executor   |
                    +---------------+-----------------------+
                                    |
                           MCP Client (outbound)
                                    |
                    +---------------+-------------------+
                    |               |                    |
                    v               v                    v
              PDF Reader      Brave / Exa           GitHub
              MCP Server      MCP Servers          MCP Server
                                                        |
                    Discord Bot  <--- Notifications -----+
                         |
                         v
                    You (approve / reject / view)
```

**Dual MCP role**: HumanOMS is both an MCP **server** (agents connect to it to manage your life) and an MCP **client** (it connects out to other MCP tools to execute workflow steps). This dual role is the core architectural insight.

**Single process**: One Bun process runs the HTTP server, MCP server, job queue, scheduler, and MCP client pool. SQLite handles all persistence. No external services required to run (Redis, Postgres, etc.).

## 5. Data Model

### 5.1 Core Tables (Structured Domains)

#### tasks

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| title | TEXT NOT NULL | |
| description | TEXT | |
| status | TEXT NOT NULL | pending, in_progress, completed, cancelled |
| priority | INTEGER | 0 (none), 1 (low), 2 (medium), 3 (high), 4 (urgent) |
| due_date | TEXT | ISO 8601 |
| recurrence | TEXT | Cron expression for recurring tasks |
| tags | TEXT | JSON array |
| metadata | TEXT | JSON object, arbitrary key-value |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

#### files

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| name | TEXT NOT NULL | Original filename |
| path | TEXT NOT NULL | Absolute path on disk |
| mime_type | TEXT | |
| size | INTEGER | Bytes |
| hash | TEXT | SHA-256 for deduplication |
| metadata | TEXT | JSON object |
| created_at | TEXT NOT NULL | |

### 5.2 Flexible Entity Store

#### entities

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| type | TEXT NOT NULL | e.g., study_note, bookmark, contact, blog_draft |
| name | TEXT NOT NULL | |
| properties | TEXT | JSON object, schema-free |
| tags | TEXT | JSON array |
| parent_id | TEXT | FK to entities, for hierarchical data |
| source_id | TEXT | FK to files/entities, tracks provenance |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

Full-text search index on `entities.name` and `entities.properties` via SQLite FTS5.

### 5.3 Workflow Engine

#### workflows

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| name | TEXT NOT NULL UNIQUE | |
| description | TEXT | |
| steps | TEXT NOT NULL | JSON array of WorkflowStep definitions |
| enabled | BOOLEAN | DEFAULT true |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

#### WorkflowStep schema (JSON within steps array)

```typescript
interface WorkflowStep {
  name: string;                          // Human-readable step name
  tool: string;                          // MCP tool name to invoke
  server: string;                        // MCP server name from registry (or "internal")
  input: Record<string, unknown>;        // Input params, supports {{variable}} interpolation
  trust_level: "auto" | "notify" | "approve";
  timeout_ms?: number;                   // Per-step timeout (default: 60000)
  retry?: { max: number; delay_ms: number };
  on_failure?: "abort" | "skip" | "retry";
  output_mapping?: Record<string, string>; // Map output fields to pipeline variables
}
```

#### jobs

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| workflow_id | TEXT NOT NULL | FK to workflows |
| status | TEXT NOT NULL | queued, running, awaiting_approval, completed, failed, cancelled, expired |
| current_step | INTEGER | DEFAULT 0 |
| input | TEXT | JSON — initial input to the workflow |
| context | TEXT | JSON — accumulated pipeline variables across steps |
| output | TEXT | JSON — final output |
| error | TEXT | Error message if failed |
| retries | INTEGER | DEFAULT 0 |
| max_retries | INTEGER | DEFAULT 3 |
| created_at | TEXT NOT NULL | |
| started_at | TEXT | |
| completed_at | TEXT | |

#### automations

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| name | TEXT NOT NULL | |
| description | TEXT | |
| cron_expression | TEXT NOT NULL | |
| workflow_id | TEXT NOT NULL | FK to workflows |
| input | TEXT | JSON — default input for each run |
| enabled | BOOLEAN | DEFAULT true |
| last_run | TEXT | |
| next_run | TEXT | |
| created_at | TEXT NOT NULL | |

### 5.4 Human-in-the-Loop

#### approvals

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| job_id | TEXT NOT NULL | FK to jobs |
| step_index | INTEGER NOT NULL | Which workflow step needs approval |
| status | TEXT NOT NULL | pending, approved, rejected, expired |
| context | TEXT | JSON — preview of what the action will do |
| token | TEXT NOT NULL UNIQUE | HMAC-SHA256 signed, single-use |
| expires_at | TEXT NOT NULL | Default: 24 hours from creation |
| responded_at | TEXT | |
| responded_via | TEXT | discord_button, rest_api, mcp_tool |
| created_at | TEXT NOT NULL | |

**Trust levels**:

| Level | Behavior | Examples |
|-------|----------|---------|
| `auto` | Executes without asking | Read PDF, search web, store data locally |
| `notify` | Executes, then informs you | Create entity, update task, generate summary |
| `approve` | Pauses, asks you, waits | Push to GitHub, publish blog post, delete data, send messages |

**Approval flow**:
1. Job executor reaches an `approve` step
2. Creates an approval record with signed token and context preview
3. Sets job status to `awaiting_approval`
4. Sends Discord message with interactive buttons (Approve / Reject / Preview)
5. User clicks button in Discord
6. Discord bot receives interaction, verifies token, updates approval
7. Job resumes or aborts based on decision
8. If no response within `expires_at`, job status becomes `expired`

**Timeout policy**: Never auto-approve. Expired = failed. The user can re-trigger manually.

### 5.5 System Tables

#### tool_registry

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| name | TEXT NOT NULL UNIQUE | e.g., pdf-reader, exa, brave-search, github, discord |
| transport | TEXT NOT NULL | stdio or sse |
| config | TEXT NOT NULL | JSON — {command, args, env} for stdio; {url} for sse |
| capabilities | TEXT | JSON — cached list of tools this server provides |
| health_status | TEXT | unknown, healthy, unhealthy |
| last_health_check | TEXT | |
| created_at | TEXT NOT NULL | |

#### secrets

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| key | TEXT NOT NULL UNIQUE | e.g., EXA_API_KEY, GITHUB_TOKEN, DISCORD_BOT_TOKEN |
| encrypted_value | TEXT NOT NULL | AES-256-GCM encrypted |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

#### audit_log

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| timestamp | TEXT NOT NULL | ISO 8601 |
| actor | TEXT NOT NULL | user, system, agent:{name}, job:{id} |
| action | TEXT NOT NULL | e.g., task.create, job.execute, approval.approve, secret.access |
| resource_type | TEXT | task, entity, file, job, workflow, secret |
| resource_id | TEXT | |
| details | TEXT | JSON — action-specific context |

Append-only. No UPDATE or DELETE on this table.

#### notification_channels

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| type | TEXT NOT NULL | discord |
| name | TEXT NOT NULL | e.g., main, alerts |
| config | TEXT NOT NULL | JSON — encrypted bot token, channel IDs |
| enabled | BOOLEAN | DEFAULT true |
| created_at | TEXT NOT NULL | |

## 6. Security Model

### 6.1 Authentication

- **REST API**: Bearer token authentication on all endpoints. API key generated on first run, stored as Argon2 hash. Raw key shown once, never stored.
- **MCP Server**: Stdio transport (local process only, inherently trusted). If SSE transport is enabled for remote access, requires the same bearer token.

### 6.2 Secrets Management

All external API keys stored encrypted at rest:
- Encryption: AES-256-GCM
- Key derivation: Master key derived from user-provided passphrase via Argon2id
- The passphrase is required on startup (entered interactively or via `HUMANOMS_MASTER_KEY` env var)
- Secrets are decrypted in memory only when needed, never logged, never included in job output or audit details

### 6.3 Approval Token Security

- Tokens are HMAC-SHA256 signed with a server-side secret
- Payload includes: job_id, step_index, expiry timestamp
- Single-use: token is invalidated after first use
- Time-bounded: expired tokens are rejected
- Discord buttons include the token; clicking calls back to the REST API

### 6.4 Audit Trail

Every significant action is logged:
- API calls (who, what, when, from where)
- Job execution (each step, inputs/outputs, duration)
- MCP tool invocations (which server, which tool, params)
- Approval decisions (who approved/rejected, when, via which channel)
- Secret access (which key was decrypted, by which job/actor)
- Configuration changes

The audit_log table is append-only. No mutations. No deletions.

### 6.5 Sandboxed Execution

- Each workflow step declares which MCP server and tool it uses
- The job executor only instantiates connections to servers required by the current step
- A step using `pdf-reader` cannot access `github` unless a subsequent step explicitly chains to it
- Internal tools (CRUD on local DB) are separate from external tools (MCP servers)

### 6.6 Input Validation

- All REST inputs validated with Zod schemas before processing
- File uploads: configurable size limits, MIME type allowlist
- Workflow definitions validated on creation (valid step schemas, referenced servers exist)
- Template interpolation (`{{variable}}`) is sanitized — no code execution

### 6.7 Rate Limiting

- Per-API-key rate limits on REST endpoints (configurable, default: 100 req/min)
- Per-MCP-server rate limits to prevent runaway workflows from burning API credits
- Global concurrent job limit (default: 5) to prevent resource exhaustion

## 7. MCP Server Interface

Tools exposed to AI agents connecting to HumanOMS:

### Task Management

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task with title, description, priority, due date, tags |
| `list_tasks` | Query tasks with filters: status, tags, due date range, priority |
| `get_task` | Get full task details by ID |
| `update_task` | Modify any task field |
| `complete_task` | Mark a task as completed |

### Entity Store

| Tool | Description |
|------|-------------|
| `create_entity` | Store a typed entity with arbitrary properties |
| `search_entities` | Full-text search + type/tag/property filters |
| `get_entity` | Retrieve by ID |
| `update_entity` | Modify entity fields |
| `delete_entity` | Remove (with audit trail) |

### File Management

| Tool | Description |
|------|-------------|
| `register_file` | Register a file path with the system (hashes and indexes it) |
| `list_files` | Query files by name, type, tags |
| `get_file_info` | Metadata for a file |

### Workflows and Jobs

| Tool | Description |
|------|-------------|
| `trigger_workflow` | Start a workflow with given input parameters |
| `list_workflows` | See available workflows |
| `list_jobs` | Query jobs with status filter |
| `get_job` | Full job details including step output and current status |
| `approve_job` | Approve a job awaiting approval |
| `reject_job` | Reject a job awaiting approval |
| `cancel_job` | Cancel a running or queued job |

### Automations

| Tool | Description |
|------|-------------|
| `create_automation` | Schedule a workflow to run on a cron expression |
| `list_automations` | View all scheduled automations |
| `toggle_automation` | Enable or disable an automation |
| `update_automation` | Modify schedule or input |

### System

| Tool | Description |
|------|-------------|
| `system_status` | Health check — DB size, active jobs, registered tools, uptime |
| `list_registered_tools` | What MCP tools are available from external servers |
| `get_audit_log` | Query recent actions with filters |

## 8. REST API

All endpoints prefixed with `/api/v1/`. All require `Authorization: Bearer <api_key>`.

```
POST   /api/v1/tasks
GET    /api/v1/tasks
GET    /api/v1/tasks/:id
PATCH  /api/v1/tasks/:id
DELETE /api/v1/tasks/:id

POST   /api/v1/entities
GET    /api/v1/entities
GET    /api/v1/entities/:id
PATCH  /api/v1/entities/:id
DELETE /api/v1/entities/:id

POST   /api/v1/files
GET    /api/v1/files
GET    /api/v1/files/:id

GET    /api/v1/workflows
POST   /api/v1/workflows
GET    /api/v1/workflows/:id
POST   /api/v1/workflows/:id/trigger

GET    /api/v1/jobs
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/approve
POST   /api/v1/jobs/:id/reject
POST   /api/v1/jobs/:id/cancel

POST   /api/v1/automations
GET    /api/v1/automations
PATCH  /api/v1/automations/:id

GET    /api/v1/audit-log
GET    /api/v1/system/status
```

### Response Format

All responses follow a consistent envelope:

```typescript
// Success
{
  "ok": true,
  "data": { ... },
  "meta": { "total": 42, "page": 1, "per_page": 20 }  // for list endpoints
}

// Error
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title is required",
    "details": { ... }  // optional, Zod error details
  }
}
```

### Pagination

List endpoints support: `?page=1&per_page=20&sort=created_at&order=desc`

### Filtering

List endpoints support field-specific query params: `?status=pending&tags=school&due_before=2026-03-01`

## 9. Example Workflows

### 9.1 Parse School PDFs and Summarize

**Trigger**: User registers PDF files and triggers the workflow.

```json
{
  "name": "parse_and_summarize_pdfs",
  "description": "Extract text from PDFs, generate study summaries, notify on Discord",
  "steps": [
    {
      "name": "extract_text",
      "tool": "read_pdf",
      "server": "pdf-reader",
      "input": { "filePath": "{{file.path}}" },
      "trust_level": "auto",
      "timeout_ms": 30000,
      "output_mapping": { "text": "extracted_text" }
    },
    {
      "name": "generate_summary",
      "tool": "llm_call",
      "server": "internal",
      "input": {
        "system": "You are a study assistant. Create a concise summary with key takeaways, important definitions, and potential exam topics.",
        "prompt": "Summarize this document:\n\n{{extracted_text}}",
        "model": "sonnet"
      },
      "trust_level": "auto",
      "timeout_ms": 120000,
      "output_mapping": { "response": "summary" }
    },
    {
      "name": "store_summary",
      "tool": "create_entity",
      "server": "internal",
      "input": {
        "type": "study_note",
        "name": "Summary: {{file.name}}",
        "properties": {
          "summary": "{{summary}}",
          "source_file_id": "{{file.id}}"
        },
        "tags": ["auto-generated", "study"]
      },
      "trust_level": "notify"
    },
    {
      "name": "notify_complete",
      "tool": "send_message",
      "server": "discord",
      "input": {
        "channelId": "{{discord.default_channel}}",
        "content": "Finished reading **{{file.name}}**.\n\n**Key points:**\n{{summary}}"
      },
      "trust_level": "auto"
    }
  ]
}
```

### 9.2 Draft Blog Post from Notes

**Trigger**: Manual or scheduled. Collects entities tagged `blog-draft`, researches context, drafts a post, pushes to GitHub as a PR.

```json
{
  "name": "blog_post_from_notes",
  "description": "Compile tagged notes into a blog post, research context, create GitHub PR",
  "steps": [
    {
      "name": "gather_notes",
      "tool": "search_entities",
      "server": "internal",
      "input": { "tags": ["blog-draft"], "type": "study_note" },
      "trust_level": "auto",
      "output_mapping": { "entities": "source_notes" }
    },
    {
      "name": "research_context",
      "tool": "web_search_exa",
      "server": "exa",
      "input": { "query": "{{source_notes.0.name}}", "numResults": 5 },
      "trust_level": "auto",
      "output_mapping": { "results": "research" }
    },
    {
      "name": "draft_post",
      "tool": "llm_call",
      "server": "internal",
      "input": {
        "system": "You are a technical blog writer. Write engaging, well-structured posts.",
        "prompt": "Write a blog post based on these notes:\n\n{{source_notes}}\n\nSupporting research:\n{{research}}",
        "model": "opus"
      },
      "trust_level": "auto",
      "output_mapping": { "response": "blog_content" }
    },
    {
      "name": "preview_and_approve",
      "tool": "noop",
      "server": "internal",
      "input": { "preview": "{{blog_content}}" },
      "trust_level": "approve"
    },
    {
      "name": "push_to_github",
      "tool": "create_or_update_file",
      "server": "github",
      "input": {
        "owner": "{{github.owner}}",
        "repo": "{{github.blog_repo}}",
        "path": "content/posts/{{slugify(source_notes.0.name)}}.md",
        "content": "{{blog_content}}",
        "message": "Add blog post: {{source_notes.0.name}}",
        "branch": "draft/{{slugify(source_notes.0.name)}}"
      },
      "trust_level": "approve"
    },
    {
      "name": "create_pr",
      "tool": "create_pull_request",
      "server": "github",
      "input": {
        "owner": "{{github.owner}}",
        "repo": "{{github.blog_repo}}",
        "title": "New post: {{source_notes.0.name}}",
        "body": "Auto-generated from HumanOMS study notes.",
        "head": "draft/{{slugify(source_notes.0.name)}}",
        "base": "main"
      },
      "trust_level": "approve",
      "output_mapping": { "html_url": "pr_url" }
    },
    {
      "name": "notify_complete",
      "tool": "send_message",
      "server": "discord",
      "input": {
        "channelId": "{{discord.default_channel}}",
        "content": "Blog post PR ready for review: {{pr_url}}"
      },
      "trust_level": "auto"
    }
  ]
}
```

Note: Steps 5 and 6 (push + PR) both require `approve`. The user sees a preview of the blog content in step 4, then explicitly approves the GitHub operations.

### 9.3 Daily Study Reminder

**Automation**: Runs every day at 8:00 AM.

```json
{
  "name": "daily_study_reminder",
  "cron_expression": "0 8 * * *",
  "workflow": {
    "name": "study_reminder",
    "steps": [
      {
        "name": "get_study_tasks",
        "tool": "list_tasks",
        "server": "internal",
        "input": {
          "tags": ["study"],
          "status": "pending",
          "due_before": "{{today_end}}"
        },
        "trust_level": "auto",
        "output_mapping": { "tasks": "due_tasks" }
      },
      {
        "name": "send_reminder",
        "tool": "send_message",
        "server": "discord",
        "input": {
          "channelId": "{{discord.default_channel}}",
          "content": "Good morning! You have {{due_tasks.length}} study tasks due today:\n{{format_task_list(due_tasks)}}"
        },
        "trust_level": "auto"
      }
    ]
  }
}
```

## 10. Project Structure

```
humanoms/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── .env.example                    # Documents all env vars (never real values)
├── src/
│   ├── index.ts                    # Entry point — boots all services
│   ├── config.ts                   # Env + config loading, validated with Zod
│   │
│   ├── db/
│   │   ├── connection.ts           # SQLite connection setup + WAL mode
│   │   ├── schema.ts              # All CREATE TABLE statements
│   │   └── migrate.ts             # Version-tracked migrations
│   │
│   ├── api/
│   │   ├── server.ts              # Hono app, mounts routes + middleware
│   │   ├── middleware/
│   │   │   ├── auth.ts            # Bearer token verification
│   │   │   ├── rate-limit.ts      # Per-key rate limiting
│   │   │   ├── audit.ts           # Audit log middleware
│   │   │   └── error-handler.ts   # Consistent error responses
│   │   └── routes/
│   │       ├── tasks.ts
│   │       ├── entities.ts
│   │       ├── files.ts
│   │       ├── workflows.ts
│   │       ├── jobs.ts
│   │       ├── automations.ts
│   │       └── system.ts
│   │
│   ├── mcp/
│   │   ├── server.ts              # Inbound MCP server (agents connect to us)
│   │   ├── tools/                 # Tool definitions mirroring REST routes
│   │   │   ├── tasks.ts
│   │   │   ├── entities.ts
│   │   │   ├── files.ts
│   │   │   ├── workflows.ts
│   │   │   └── system.ts
│   │   └── client/
│   │       ├── pool.ts            # Manages outbound MCP server connections
│   │       └── registry.ts        # Tool registry CRUD + health checks
│   │
│   ├── jobs/
│   │   ├── queue.ts               # SQLite-backed job queue (enqueue, dequeue, status)
│   │   ├── executor.ts            # Step-by-step workflow executor with variable interpolation
│   │   ├── approval.ts            # Approval gate: create, verify, resolve
│   │   └── context.ts             # Pipeline variable store for a running job
│   │
│   ├── scheduler/
│   │   ├── scheduler.ts           # Croner-based cron runner
│   │   └── recurring-tasks.ts     # Generate task instances from recurrence expressions
│   │
│   ├── notifications/
│   │   ├── discord.ts             # Discord bot: send messages, interactive buttons, receive responses
│   │   └── dispatcher.ts          # Route notifications to configured channels
│   │
│   ├── llm/
│   │   ├── client.ts              # Claude Code SDK wrapper
│   │   └── router.ts              # Auto model selection (haiku/sonnet/opus)
│   │
│   ├── security/
│   │   ├── encryption.ts          # AES-256-GCM encrypt/decrypt
│   │   ├── secrets.ts             # Secret store: encrypted CRUD
│   │   ├── tokens.ts              # HMAC approval token generation + verification
│   │   ├── auth.ts                # API key generation, Argon2 hashing, verification
│   │   └── audit.ts               # Audit log writes
│   │
│   └── lib/
│       ├── ulid.ts                # ULID generation
│       ├── validation.ts          # Shared Zod schemas (task, entity, workflow, etc.)
│       ├── template.ts            # {{variable}} interpolation engine
│       ├── search-router.ts       # Brave vs Exa routing logic
│       └── logger.ts              # Structured logging (pino or similar)
│
├── workflows/                      # Pre-built workflow JSON templates
│   ├── parse-pdf-summarize.json
│   ├── blog-post-from-notes.json
│   └── daily-study-reminder.json
│
├── tests/
│   ├── api/                        # REST endpoint tests
│   ├── jobs/                       # Job queue + executor tests
│   ├── mcp/                        # MCP server + client tests
│   ├── security/                   # Encryption, auth, token tests
│   └── fixtures/                   # Test data
│
└── scripts/
    └── setup.ts                    # Interactive first-run setup wizard
```

## 11. First-Run Experience

```
$ bun run src/index.ts

  HumanOMS v0.1.0 — First-time setup

  [1/6] Creating database... done
  [2/6] Set a master passphrase for encrypting secrets:
        > ********
        Confirm: ********
  [3/6] Generating REST API key...
        Your API key: homs_k1_xxxxxxxxxxxxxxxxxxxx
        (Save this — it won't be shown again)
  [4/6] Configure Discord bot? (paste bot token or press Enter to skip)
        > xxxxxxxxxxx
        Default notification channel ID?
        > 1234567890
  [5/6] Configure API keys for external services:
        Brave Search API key? (Enter to skip) > xxxx
        Exa API key? (Enter to skip) > xxxx
        GitHub token? (Enter to skip) > ghp_xxxx
  [6/6] Registering MCP tool servers... done
        Verifying Claude Code SDK access... authenticated (Max plan)

  HumanOMS running:
    REST API:   http://localhost:3747
    MCP Server: stdio (connect via claude config)
    LLM:        Claude Code SDK (Max plan — no API key needed)

  Registered tools:
    pdf-reader    4 tools available
    brave-search  2 tools available
    exa           6 tools available
    github       20 tools available
    discord       8 tools available
```

## 12. LLM Integration — Claude Code SDK

### No API Key Required

HumanOMS uses `@anthropic-ai/claude-code` — the official Claude Code SDK. Since the user is on the Max plan, all LLM calls go through the existing subscription. No separate Anthropic API key needed.

### Smart Model Routing

Each `llm_call` workflow step can specify a model or use `"auto"`:

| Model | When to Use | Cost |
|-------|-------------|------|
| `haiku` | Classification, formatting, tag suggestions, simple extraction, daily digest generation | Included in Max |
| `sonnet` | Summarization, research synthesis, routine drafts, study notes | Included in Max |
| `opus` | Complex analysis, long-form writing, nuanced multi-source reasoning, blog posts | Included in Max |

Auto-routing heuristics:
- **Input token count < 1000 + simple instruction** (classify, format, extract) -> Haiku
- **Input token count 1000-10000 + synthesis instruction** (summarize, draft, analyze) -> Sonnet
- **Input token count > 10000 OR complex reasoning** (multi-source synthesis, creative writing, deep analysis) -> Opus
- Workflow step can override with explicit `"model": "haiku" | "sonnet" | "opus"`

### Implementation

```typescript
import { claude } from "@anthropic-ai/claude-code";

async function llmCall(input: {
  system?: string;
  prompt: string;
  model?: "auto" | "haiku" | "sonnet" | "opus";
}): Promise<string> {
  const model = input.model === "auto" || !input.model
    ? routeModel(input.prompt)
    : input.model;

  const modelMap = {
    haiku: "claude-haiku-4-5-20251001",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };

  const result = await claude({
    prompt: input.prompt,
    options: {
      model: modelMap[model],
      systemPrompt: input.system,
      maxTurns: 1,
    },
  });

  return result.stdout;
}
```

### Project Structure Addition

```
src/
  └── llm/
      ├── client.ts            # Claude Code SDK wrapper
      └── router.ts            # Auto model selection logic
```

## 13. Future Domains (Post-V1)

Not in scope for V1, but the entity store + workflow engine supports these naturally:

- **Contacts** — entity type `contact`, workflows for birthday reminders
- **Finances** — entity type `transaction`, recurring budget check automations
- **Health** — entity type `health_log`, medication reminders
- **Bookmarks** — entity type `bookmark`, auto-tag and summarize saved links
- **Calendar** — sync with CalDAV, surface schedule conflicts in daily reminder
- **Email** — triage inbox via LLM, draft replies pending approval

Each domain is just: a new entity type (or structured table if it needs it) + new workflow templates. The core platform doesn't change.

## 15. Open Questions

1. **File storage** — V1 references files by path. Should we copy files into a managed directory for portability?
2. **Multi-device sync** — V1 is single-machine. Could integrate HumanSync later for multi-device.
3. **Web UI** — V1 is API-only (MCP + REST). A dashboard would be nice but is not V1 scope.
4. **Plugin system** — Should third-party workflow templates be installable from a registry?
5. **Ollama fallback** — Add local model support for offline/free use cases in a future version?
