# HumanOMS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first personal AI task orchestration platform that stores life data, chains MCP tools via async workflows, and uses Discord for human-in-the-loop approval gates.

**Architecture:** Single Bun process running Hono REST API + MCP server (inbound) + MCP client pool (outbound) + SQLite-backed job queue + croner scheduler. Claude Agent SDK for LLM calls using the user's Max subscription. Discord bot for notifications and interactive approval buttons.

**Tech Stack:** Bun, TypeScript, Hono, SQLite (`bun:sqlite`), `@modelcontextprotocol/sdk@1.26.0`, `@anthropic-ai/claude-agent-sdk@0.2.47`, `croner@10`, `zod@3`, `ulidx`, `discord.js@14`, `pino`, `@node-rs/argon2`

**Design Doc:** `docs/plans/2026-02-19-humanoms-design.md`

### Grounding Corrections (2026-02-19)

These corrections were verified against actual package docs via Context7:

1. **MCP SDK**: Use v1 deep imports (`@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/client/index.js`). v2 package (`@modelcontextprotocol/server`) is NOT published yet.
2. **MCP Tool Registration**: Use `server.tool()` with raw zod shapes (NOT `server.registerTool()` which is v2-only).
3. **Zod**: Stay on v3 — MCP SDK v1 depends on it. v4 only needed when MCP v2 ships.
4. **Claude Agent SDK**: Use `unstable_v2_prompt()` for one-shot LLM calls (cleaner than v1 `query()` generator). Falls back to `query()` if v2 is removed.
5. **Discord.js**: Use `channel.send()` + global `interactionCreate` listener pattern (NOT slash-command reply pattern). Custom IDs encode approval tokens.
6. **Croner**: Confirmed working exactly as planned. `new Cron("0 8 * * *", callback)`.

---

## Phase 1: Project Scaffolding + Database

### Task 1: Initialize Bun project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize project**

```bash
cd /Users/manavpanchal/Desktop/Projects/humanoms
bun init -y
```

**Step 2: Install core dependencies**

```bash
bun add hono @hono/node-server zod@3 ulidx croner pino @node-rs/argon2
bun add -d @types/bun typescript pino-pretty
```

Note: Use zod@3 (not v4) for compatibility with `@modelcontextprotocol/sdk` which depends on zod v3. We can upgrade later when the MCP SDK supports v4.

**Step 3: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "types": ["bun-types"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create bunfig.toml**

```toml
[test]
preload = ["./tests/setup.ts"]
```

**Step 5: Create .env.example**

```env
# HumanOMS Configuration
HUMANOMS_PORT=3747
HUMANOMS_HOST=localhost
HUMANOMS_DB_PATH=./data/humanoms.db
HUMANOMS_MASTER_KEY=  # Required: passphrase for encrypting secrets
HUMANOMS_LOG_LEVEL=info

# External Services (stored encrypted in DB after first-run setup)
# These are only needed for the setup wizard, not at runtime
# BRAVE_SEARCH_API_KEY=
# EXA_API_KEY=
# GITHUB_TOKEN=
# DISCORD_BOT_TOKEN=
# DISCORD_CHANNEL_ID=
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
data/
*.db
*.db-wal
*.db-shm
.env
.env.local
```

**Step 7: Create directory structure**

```bash
mkdir -p src/{api/{middleware,routes},mcp/{tools,client},jobs,scheduler,notifications,security,llm,lib,db}
mkdir -p tests/{api,jobs,mcp,security,fixtures}
mkdir -p workflows
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize project scaffolding with Bun + TypeScript"
```

---

### Task 2: SQLite database layer

**Files:**
- Create: `src/db/connection.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/migrate.ts`
- Test: `tests/db/schema.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/db/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";

describe("Database Schema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    applySchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("files");
    expect(tableNames).toContain("entities");
    expect(tableNames).toContain("workflows");
    expect(tableNames).toContain("jobs");
    expect(tableNames).toContain("automations");
    expect(tableNames).toContain("approvals");
    expect(tableNames).toContain("tool_registry");
    expect(tableNames).toContain("secrets");
    expect(tableNames).toContain("audit_log");
    expect(tableNames).toContain("notification_channels");
  });

  it("can insert and query a task", () => {
    applySchema(db);

    db.run(
      `INSERT INTO tasks (id, title, status, created_at, updated_at)
       VALUES ('01ABC', 'Test task', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );

    const task = db.query("SELECT * FROM tasks WHERE id = '01ABC'").get() as any;
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("pending");
  });

  it("enables WAL mode", () => {
    applySchema(db);

    const result = db.query("PRAGMA journal_mode").get() as any;
    expect(result.journal_mode).toBe("wal");
  });

  it("creates FTS5 index on entities", () => {
    applySchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'")
      .all();
    expect(tables.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/db/schema.test.ts
```

Expected: FAIL — `@/db/schema` module not found.

**Step 3: Create the database connection module**

```typescript
// src/db/connection.ts
import { Database } from "bun:sqlite";
import { applySchema } from "./schema";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(dbPath: string): Database {
  db = new Database(dbPath, { create: true });
  applySchema(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

**Step 4: Create the schema module**

```typescript
// src/db/schema.ts
import { Database } from "bun:sqlite";

export function applySchema(db: Database): void {
  // Enable WAL mode for concurrent reads
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      due_date TEXT,
      recurrence TEXT,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      hash TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      parent_id TEXT REFERENCES entities(id),
      source_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      steps TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      status TEXT NOT NULL DEFAULT 'queued',
      current_step INTEGER DEFAULT 0,
      input TEXT DEFAULT '{}',
      context TEXT DEFAULT '{}',
      output TEXT,
      error TEXT,
      retries INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      input TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      step_index INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      context TEXT,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      responded_at TEXT,
      responded_via TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_registry (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      transport TEXT NOT NULL,
      config TEXT NOT NULL,
      capabilities TEXT,
      health_status TEXT DEFAULT 'unknown',
      last_health_check TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // FTS5 index for entity search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
      name, properties, tags,
      content='entities',
      content_rowid='rowid'
    );
  `);

  // Indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_workflow_id ON jobs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
    CREATE INDEX IF NOT EXISTS idx_approvals_job_id ON approvals(job_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_token ON approvals(token);
  `);
}
```

**Step 5: Create test setup**

```typescript
// tests/setup.ts
// Bun test preload — nothing needed for now, but available for global setup
```

**Step 6: Run test to verify it passes**

```bash
bun test tests/db/schema.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/db/ tests/
git commit -m "feat: add SQLite schema with all tables, FTS5, and indexes"
```

---

### Task 3: ULID + shared utilities

**Files:**
- Create: `src/lib/ulid.ts`
- Create: `src/lib/logger.ts`
- Create: `src/lib/validation.ts`
- Test: `tests/lib/ulid.test.ts`
- Test: `tests/lib/validation.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/lib/ulid.test.ts
import { describe, it, expect } from "bun:test";
import { generateId } from "@/lib/ulid";

describe("ULID generation", () => {
  it("generates a valid ULID string", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("generates sortable IDs (later calls produce larger strings)", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id2 >= id1).toBe(true);
  });
});
```

```typescript
// tests/lib/validation.test.ts
import { describe, it, expect } from "bun:test";
import { CreateTaskSchema, CreateEntitySchema } from "@/lib/validation";

describe("Validation schemas", () => {
  it("validates a valid task", () => {
    const result = CreateTaskSchema.safeParse({
      title: "Study for exam",
      priority: 2,
      tags: ["study"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a task without title", () => {
    const result = CreateTaskSchema.safeParse({ priority: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = CreateTaskSchema.safeParse({
      title: "Test",
      priority: 10,
    });
    expect(result.success).toBe(false);
  });

  it("validates a valid entity", () => {
    const result = CreateEntitySchema.safeParse({
      type: "study_note",
      name: "Chapter 1 Summary",
      properties: { summary: "Important stuff" },
      tags: ["study"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entity without type", () => {
    const result = CreateEntitySchema.safeParse({ name: "Test" });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/lib/
```

Expected: FAIL — modules not found.

**Step 3: Implement ULID generator**

```typescript
// src/lib/ulid.ts
import { ulid } from "ulidx";

export function generateId(): string {
  return ulid();
}
```

**Step 4: Implement logger**

```typescript
// src/lib/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.HUMANOMS_LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
```

**Step 5: Implement validation schemas**

```typescript
// src/lib/validation.ts
import { z } from "zod";

// --- Tasks ---

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  status: TaskStatusSchema.default("pending"),
  priority: z.number().int().min(0).max(4).default(0),
  due_date: z.string().datetime().optional(),
  recurrence: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

// --- Entities ---

export const CreateEntitySchema = z.object({
  type: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  properties: z.record(z.unknown()).default({}),
  tags: z.array(z.string().max(100)).max(50).default([]),
  parent_id: z.string().optional(),
  source_id: z.string().optional(),
});

export const UpdateEntitySchema = CreateEntitySchema.partial();

// --- Files ---

export const RegisterFileSchema = z.object({
  name: z.string().min(1).max(500),
  path: z.string().min(1),
  mime_type: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).default({}),
});

// --- Workflows ---

export const TrustLevelSchema = z.enum(["auto", "notify", "approve"]);

export const WorkflowStepSchema = z.object({
  name: z.string().min(1).max(200),
  tool: z.string().min(1),
  server: z.string().min(1),
  input: z.record(z.unknown()),
  trust_level: TrustLevelSchema,
  timeout_ms: z.number().int().positive().default(60000),
  retry: z
    .object({
      max: z.number().int().min(0).max(10),
      delay_ms: z.number().int().positive(),
    })
    .optional(),
  on_failure: z.enum(["abort", "skip", "retry"]).default("abort"),
  output_mapping: z.record(z.string()).optional(),
});

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(50),
});

export const TriggerWorkflowSchema = z.object({
  input: z.record(z.unknown()).default({}),
});

// --- Automations ---

export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cron_expression: z.string().min(1).max(100),
  workflow_id: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const UpdateAutomationSchema = CreateAutomationSchema.partial();

// --- Pagination ---

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// --- API response helpers ---

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: { total: number; page: number; per_page: number };
};

export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
```

**Step 6: Run tests to verify they pass**

```bash
bun test tests/lib/
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/ tests/lib/
git commit -m "feat: add ULID generator, logger, and Zod validation schemas"
```

---

## Phase 2: Security Foundations

### Task 4: Encryption + secrets store

**Files:**
- Create: `src/security/encryption.ts`
- Create: `src/security/secrets.ts`
- Test: `tests/security/encryption.test.ts`
- Test: `tests/security/secrets.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/security/encryption.test.ts
import { describe, it, expect } from "bun:test";
import { encrypt, decrypt, deriveKey } from "@/security/encryption";

describe("Encryption", () => {
  const passphrase = "test-master-passphrase-123";

  it("encrypts and decrypts a string", () => {
    const key = deriveKey(passphrase);
    const plaintext = "sk-ant-my-secret-api-key";
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const key = deriveKey(passphrase);
    const plaintext = "same-text";
    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);
    expect(enc1).not.toBe(enc2);
  });

  it("fails to decrypt with wrong key", () => {
    const key1 = deriveKey("correct-passphrase");
    const key2 = deriveKey("wrong-passphrase");
    const encrypted = encrypt("secret", key1);
    expect(() => decrypt(encrypted, key2)).toThrow();
  });

  it("derives consistent key from same passphrase + salt", () => {
    const key1 = deriveKey(passphrase, "fixed-salt");
    const key2 = deriveKey(passphrase, "fixed-salt");
    expect(Buffer.from(key1).toString("hex")).toBe(
      Buffer.from(key2).toString("hex")
    );
  });
});
```

```typescript
// tests/security/secrets.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";
import { SecretStore } from "@/security/secrets";
import { deriveKey } from "@/security/encryption";

describe("SecretStore", () => {
  let db: Database;
  let store: SecretStore;
  const masterKey = deriveKey("test-passphrase");

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    store = new SecretStore(db, masterKey);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and retrieves a secret", () => {
    store.set("EXA_API_KEY", "exa-test-key-123");
    const value = store.get("EXA_API_KEY");
    expect(value).toBe("exa-test-key-123");
  });

  it("returns null for non-existent secret", () => {
    const value = store.get("NONEXISTENT");
    expect(value).toBeNull();
  });

  it("overwrites existing secret", () => {
    store.set("KEY", "value1");
    store.set("KEY", "value2");
    expect(store.get("KEY")).toBe("value2");
  });

  it("deletes a secret", () => {
    store.set("KEY", "value");
    store.delete("KEY");
    expect(store.get("KEY")).toBeNull();
  });

  it("lists secret keys without exposing values", () => {
    store.set("KEY_A", "val");
    store.set("KEY_B", "val");
    const keys = store.list();
    expect(keys).toContain("KEY_A");
    expect(keys).toContain("KEY_B");
  });

  it("stores encrypted value (not plaintext) in DB", () => {
    store.set("MY_KEY", "plaintext-secret");
    const row = db.query("SELECT encrypted_value FROM secrets WHERE key = 'MY_KEY'").get() as any;
    expect(row.encrypted_value).not.toBe("plaintext-secret");
    expect(row.encrypted_value).toBeTruthy();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/security/
```

**Step 3: Implement encryption module**

```typescript
// src/security/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

export function deriveKey(passphrase: string, salt?: string): Buffer {
  const saltBuffer = salt
    ? Buffer.from(salt, "utf-8")
    : Buffer.alloc(SALT_LENGTH, "humanoms-default-salt");
  return scryptSync(passphrase, saltBuffer, KEY_LENGTH);
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedStr: string, key: Buffer): string {
  const [ivHex, authTagHex, ciphertext] = encryptedStr.split(":");
  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf-8");
  decrypted += decipher.final("utf-8");

  return decrypted;
}
```

**Step 4: Implement secret store**

```typescript
// src/security/secrets.ts
import { Database } from "bun:sqlite";
import { encrypt, decrypt } from "./encryption";
import { generateId } from "../lib/ulid";

export class SecretStore {
  constructor(
    private db: Database,
    private masterKey: Buffer
  ) {}

  set(key: string, value: string): void {
    const encrypted = encrypt(value, this.masterKey);
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO secrets (id, key, encrypted_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = ?`,
      [generateId(), key, encrypted, now, now, encrypted, now]
    );
  }

  get(key: string): string | null {
    const row = this.db
      .query("SELECT encrypted_value FROM secrets WHERE key = ?")
      .get(key) as { encrypted_value: string } | null;

    if (!row) return null;
    return decrypt(row.encrypted_value, this.masterKey);
  }

  delete(key: string): void {
    this.db.run("DELETE FROM secrets WHERE key = ?", [key]);
  }

  list(): string[] {
    const rows = this.db
      .query("SELECT key FROM secrets ORDER BY key")
      .all() as { key: string }[];
    return rows.map((r) => r.key);
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/security/
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/security/ tests/security/
git commit -m "feat: add AES-256-GCM encryption and encrypted secret store"
```

---

### Task 5: API key auth + audit log

**Files:**
- Create: `src/security/auth.ts`
- Create: `src/security/audit.ts`
- Create: `src/security/tokens.ts`
- Test: `tests/security/auth.test.ts`
- Test: `tests/security/audit.test.ts`
- Test: `tests/security/tokens.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/security/auth.test.ts
import { describe, it, expect } from "bun:test";
import { generateApiKey, hashApiKey, verifyApiKey } from "@/security/auth";

describe("API Key Auth", () => {
  it("generates a key with homs_ prefix", () => {
    const { raw } = generateApiKey();
    expect(raw.startsWith("homs_")).toBe(true);
  });

  it("verifies a correct key against its hash", async () => {
    const { raw, hash } = generateApiKey();
    const valid = await verifyApiKey(raw, hash);
    expect(valid).toBe(true);
  });

  it("rejects an incorrect key", async () => {
    const { hash } = generateApiKey();
    const valid = await verifyApiKey("homs_wrongkey", hash);
    expect(valid).toBe(false);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey().raw));
    expect(keys.size).toBe(20);
  });
});
```

```typescript
// tests/security/audit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";
import { AuditLog } from "@/security/audit";

describe("AuditLog", () => {
  let db: Database;
  let audit: AuditLog;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    audit = new AuditLog(db);
  });

  afterEach(() => {
    db.close();
  });

  it("logs an action", () => {
    audit.log({
      actor: "user",
      action: "task.create",
      resource_type: "task",
      resource_id: "01ABC",
      details: { title: "Test" },
    });

    const entries = audit.query({ limit: 10 });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("task.create");
    expect(entries[0].actor).toBe("user");
  });

  it("queries by actor", () => {
    audit.log({ actor: "user", action: "task.create" });
    audit.log({ actor: "system", action: "job.execute" });
    audit.log({ actor: "user", action: "task.update" });

    const entries = audit.query({ actor: "user", limit: 10 });
    expect(entries.length).toBe(2);
  });

  it("queries by action", () => {
    audit.log({ actor: "user", action: "task.create" });
    audit.log({ actor: "user", action: "task.update" });

    const entries = audit.query({ action: "task.create", limit: 10 });
    expect(entries.length).toBe(1);
  });

  it("returns entries in reverse chronological order", () => {
    audit.log({ actor: "user", action: "first" });
    audit.log({ actor: "user", action: "second" });

    const entries = audit.query({ limit: 10 });
    expect(entries[0].action).toBe("second");
    expect(entries[1].action).toBe("first");
  });
});
```

```typescript
// tests/security/tokens.test.ts
import { describe, it, expect } from "bun:test";
import { createApprovalToken, verifyApprovalToken } from "@/security/tokens";

describe("Approval Tokens", () => {
  const secret = "test-hmac-secret";

  it("creates and verifies a valid token", () => {
    const token = createApprovalToken(
      { job_id: "job1", step_index: 2 },
      secret,
      60 * 60 * 1000 // 1 hour
    );
    const payload = verifyApprovalToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.job_id).toBe("job1");
    expect(payload!.step_index).toBe(2);
  });

  it("rejects a token with wrong secret", () => {
    const token = createApprovalToken(
      { job_id: "job1", step_index: 0 },
      secret,
      60000
    );
    const payload = verifyApprovalToken(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createApprovalToken(
      { job_id: "job1", step_index: 0 },
      secret,
      -1000 // expired 1 second ago
    );
    const payload = verifyApprovalToken(token, secret);
    expect(payload).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/security/
```

**Step 3: Implement auth module**

```typescript
// src/security/auth.ts
import { randomBytes } from "crypto";
import { hash, verify } from "@node-rs/argon2";

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `homs_${randomBytes(24).toString("base64url")}`;
  // We return a promise-based hash, but for simplicity in generation,
  // we'll hash synchronously via a wrapper
  return { raw, hash: raw }; // placeholder — actual hash done async
}

// Async API key operations (Argon2 is async)
export async function hashApiKey(raw: string): Promise<string> {
  return hash(raw);
}

export async function verifyApiKey(
  raw: string,
  hashed: string
): Promise<boolean> {
  try {
    return await verify(hashed, raw);
  } catch {
    return false;
  }
}

// Synchronous key generation with async hash
export function generateApiKeySync(): { raw: string } {
  const raw = `homs_${randomBytes(24).toString("base64url")}`;
  return { raw };
}
```

Note: Update `generateApiKey` to be async:

```typescript
// src/security/auth.ts
import { randomBytes } from "crypto";
import { hash, verify } from "@node-rs/argon2";

export async function generateApiKey(): Promise<{ raw: string; hash: string }> {
  const raw = `homs_${randomBytes(24).toString("base64url")}`;
  const hashed = await hash(raw);
  return { raw, hash: hashed };
}

export async function verifyApiKey(
  raw: string,
  hashed: string
): Promise<boolean> {
  try {
    return await verify(hashed, raw);
  } catch {
    return false;
  }
}
```

Update the test to use async:

```typescript
// tests/security/auth.test.ts — update
it("generates a key with homs_ prefix", async () => {
  const { raw } = await generateApiKey();
  expect(raw.startsWith("homs_")).toBe(true);
});

it("verifies a correct key against its hash", async () => {
  const { raw, hash } = await generateApiKey();
  const valid = await verifyApiKey(raw, hash);
  expect(valid).toBe(true);
});

it("rejects an incorrect key", async () => {
  const { hash } = await generateApiKey();
  const valid = await verifyApiKey("homs_wrongkey", hash);
  expect(valid).toBe(false);
});

it("generates unique keys", async () => {
  const keys = new Set(
    await Promise.all(Array.from({ length: 20 }, async () => (await generateApiKey()).raw))
  );
  expect(keys.size).toBe(20);
});
```

**Step 4: Implement audit log**

```typescript
// src/security/audit.ts
import { Database } from "bun:sqlite";
import { generateId } from "../lib/ulid";

interface AuditEntry {
  actor: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}

interface AuditRecord extends AuditEntry {
  id: string;
  timestamp: string;
}

interface AuditQuery {
  actor?: string;
  action?: string;
  resource_type?: string;
  limit?: number;
  offset?: number;
}

export class AuditLog {
  constructor(private db: Database) {}

  log(entry: AuditEntry): void {
    this.db.run(
      `INSERT INTO audit_log (id, timestamp, actor, action, resource_type, resource_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        new Date().toISOString(),
        entry.actor,
        entry.action,
        entry.resource_type ?? null,
        entry.resource_id ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
      ]
    );
  }

  query(params: AuditQuery): AuditRecord[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.actor) {
      conditions.push("actor = ?");
      values.push(params.actor);
    }
    if (params.action) {
      conditions.push("action = ?");
      values.push(params.action);
    }
    if (params.resource_type) {
      conditions.push("resource_type = ?");
      values.push(params.resource_type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = this.db
      .query(
        `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as any[];

    return rows.map((row) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : undefined,
    }));
  }
}
```

**Step 5: Implement approval tokens**

```typescript
// src/security/tokens.ts
import { createHmac, timingSafeEqual } from "crypto";

interface ApprovalPayload {
  job_id: string;
  step_index: number;
}

export function createApprovalToken(
  payload: ApprovalPayload,
  secret: string,
  ttlMs: number
): string {
  const expires = Date.now() + ttlMs;
  const data = JSON.stringify({ ...payload, exp: expires });
  const encoded = Buffer.from(data).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyApprovalToken(
  token: string,
  secret: string
): ApprovalPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSig = createHmac("sha256", secret).update(encoded).digest("base64url");

  // Timing-safe comparison
  try {
    const sigBuf = Buffer.from(signature, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));

  // Check expiry
  if (data.exp < Date.now()) return null;

  return { job_id: data.job_id, step_index: data.step_index };
}
```

**Step 6: Run tests to verify they pass**

```bash
bun test tests/security/
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/security/ tests/security/
git commit -m "feat: add API key auth (Argon2), audit log, and HMAC approval tokens"
```

---

## Phase 3: REST API

### Task 6: Hono server + middleware

**Files:**
- Create: `src/api/server.ts`
- Create: `src/api/middleware/auth.ts`
- Create: `src/api/middleware/error-handler.ts`
- Create: `src/api/middleware/audit.ts`
- Create: `src/api/middleware/rate-limit.ts`
- Test: `tests/api/server.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";
import { createApp } from "@/api/server";

describe("API Server", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null }); // null = no auth for tests
  });

  afterEach(() => {
    db.close();
  });

  it("returns 200 on health check", async () => {
    const res = await app.request("/api/v1/system/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await app.request("/api/v1/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 401 when auth is enabled and no key provided", async () => {
    const authedApp = createApp({ db, apiKeyHash: "some-hash" });
    const res = await authedApp.request("/api/v1/tasks");
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/api/server.test.ts
```

**Step 3: Implement middleware**

```typescript
// src/api/middleware/error-handler.ts
import { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error("Unhandled error:", err);
  return c.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    500
  );
}
```

```typescript
// src/api/middleware/auth.ts
import { Context, Next } from "hono";
import { verifyApiKey } from "../../security/auth";

export function authMiddleware(apiKeyHash: string | null) {
  return async (c: Context, next: Next) => {
    // Skip auth for health check
    if (c.req.path === "/api/v1/system/status" && c.req.method === "GET") {
      return next();
    }

    // If no auth configured (dev/test mode), skip
    if (!apiKeyHash) return next();

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Missing API key" } },
        401
      );
    }

    const key = authHeader.slice(7);
    const valid = await verifyApiKey(key, apiKeyHash);
    if (!valid) {
      return c.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
        401
      );
    }

    return next();
  };
}
```

```typescript
// src/api/middleware/rate-limit.ts
import { Context, Next } from "hono";

const windowMs = 60_000; // 1 minute
const maxRequests = 100;
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const key = c.req.header("Authorization") || "anonymous";
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      return c.json(
        { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429
      );
    }

    return next();
  };
}
```

```typescript
// src/api/middleware/audit.ts
import { Context, Next } from "hono";
import { AuditLog } from "../../security/audit";

export function auditMiddleware(audit: AuditLog) {
  return async (c: Context, next: Next) => {
    await next();

    // Only audit mutating requests
    if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
      audit.log({
        actor: "user",
        action: `api.${c.req.method.toLowerCase()}.${c.req.path}`,
        details: { status: c.res.status },
      });
    }
  };
}
```

**Step 4: Implement server**

```typescript
// src/api/server.ts
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { auditMiddleware } from "./middleware/audit";
import { AuditLog } from "../security/audit";

interface AppConfig {
  db: Database;
  apiKeyHash: string | null;
}

export function createApp(config: AppConfig) {
  const app = new Hono();
  const audit = new AuditLog(config.db);

  // Global middleware
  app.use("/api/*", rateLimitMiddleware());
  app.use("/api/*", authMiddleware(config.apiKeyHash));
  app.use("/api/*", auditMiddleware(audit));

  // Health check
  app.get("/api/v1/system/status", (c) => {
    return c.json({
      ok: true,
      data: {
        status: "running",
        uptime: process.uptime(),
        version: "0.1.0",
      },
    });
  });

  // 404 fallback
  app.notFound((c) => {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
      404
    );
  });

  // Error handler
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
      500
    );
  });

  return app;
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/api/server.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/api/ tests/api/
git commit -m "feat: add Hono server with auth, rate-limit, and audit middleware"
```

---

### Task 7: Tasks CRUD routes

**Files:**
- Create: `src/api/routes/tasks.ts`
- Test: `tests/api/tasks.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/api/tasks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";
import { createApp } from "@/api/server";

describe("Tasks API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null });
  });

  afterEach(() => {
    db.close();
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates a task", async () => {
    const res = await post("/api/v1/tasks", { title: "Study for exam" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("Study for exam");
    expect(body.data.status).toBe("pending");
    expect(body.data.id).toBeTruthy();
  });

  it("rejects task without title", async () => {
    const res = await post("/api/v1/tasks", { priority: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("lists tasks", async () => {
    await post("/api/v1/tasks", { title: "Task 1" });
    await post("/api/v1/tasks", { title: "Task 2" });

    const res = await app.request("/api/v1/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  it("gets a task by ID", async () => {
    const createRes = await post("/api/v1/tasks", { title: "My task" });
    const { data } = await createRes.json();

    const res = await app.request(`/api/v1/tasks/${data.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("My task");
  });

  it("updates a task", async () => {
    const createRes = await post("/api/v1/tasks", { title: "Old title" });
    const { data } = await createRes.json();

    const res = await app.request(`/api/v1/tasks/${data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title", status: "completed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("New title");
    expect(body.data.status).toBe("completed");
  });

  it("deletes a task", async () => {
    const createRes = await post("/api/v1/tasks", { title: "Delete me" });
    const { data } = await createRes.json();

    const res = await app.request(`/api/v1/tasks/${data.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const getRes = await app.request(`/api/v1/tasks/${data.id}`);
    expect(getRes.status).toBe(404);
  });

  it("filters tasks by status", async () => {
    await post("/api/v1/tasks", { title: "Pending" });
    const createRes = await post("/api/v1/tasks", { title: "Done" });
    const { data } = await createRes.json();
    await app.request(`/api/v1/tasks/${data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });

    const res = await app.request("/api/v1/tasks?status=pending");
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("Pending");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/api/tasks.test.ts
```

**Step 3: Implement tasks route**

```typescript
// src/api/routes/tasks.ts
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { generateId } from "../../lib/ulid";
import { CreateTaskSchema, UpdateTaskSchema } from "../../lib/validation";

export function tasksRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() } },
        400
      );
    }

    const task = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO tasks (id, title, description, status, priority, due_date, recurrence, tags, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, task.title, task.description ?? null, task.status, task.priority, task.due_date ?? null, task.recurrence ?? null, JSON.stringify(task.tags), JSON.stringify(task.metadata), now, now]
    );

    const created = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    return c.json({ ok: true, data: deserializeTask(created) }, 201);
  });

  router.get("/", (c) => {
    const status = c.req.query("status");
    const tag = c.req.query("tags");

    let query = "SELECT * FROM tasks";
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY created_at DESC";

    const rows = db.query(query).all(...params) as any[];
    return c.json({ ok: true, data: rows.map(deserializeTask) });
  });

  router.get("/:id", (c) => {
    const row = db.query("SELECT * FROM tasks WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
    }
    return c.json({ ok: true, data: deserializeTask(row) });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!existing) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
    }

    const body = await c.req.json();
    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() } },
        400
      );
    }

    const updates = parsed.data;
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [new Date().toISOString()];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        values.push(key === "tags" || key === "metadata" ? JSON.stringify(value) : value);
      }
    }

    values.push(id);
    db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);

    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    return c.json({ ok: true, data: deserializeTask(updated) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!existing) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
    }
    db.run("DELETE FROM tasks WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  return router;
}

function deserializeTask(row: any) {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}
```

**Step 4: Mount routes in server**

Update `src/api/server.ts` to import and mount tasks routes:

```typescript
// Add to src/api/server.ts
import { tasksRoutes } from "./routes/tasks";

// Inside createApp, before the notFound handler:
app.route("/api/v1/tasks", tasksRoutes(config.db));
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/api/tasks.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/api/ tests/api/
git commit -m "feat: add tasks CRUD REST API with validation and filtering"
```

---

### Task 8: Entities CRUD routes

**Files:**
- Create: `src/api/routes/entities.ts`
- Test: `tests/api/entities.test.ts`

Follow the same pattern as Task 7 but for entities — CRUD with type/tag filtering and FTS5 search. Include a `GET /api/v1/entities?q=search+term` endpoint that queries the FTS5 index.

**Step 1-6:** Same TDD cycle as Task 7. Write tests first, implement `entitiesRoutes(db)`, mount in server, verify, commit.

```bash
git commit -m "feat: add entities CRUD REST API with full-text search"
```

---

### Task 9: Files + Workflows + Jobs + Automations routes

**Files:**
- Create: `src/api/routes/files.ts`
- Create: `src/api/routes/workflows.ts`
- Create: `src/api/routes/jobs.ts`
- Create: `src/api/routes/automations.ts`
- Test: `tests/api/files.test.ts`
- Test: `tests/api/workflows.test.ts`

Follow the same TDD pattern for each. Key points:
- Files: `register_file` computes SHA-256 hash and stores metadata
- Workflows: CRUD + trigger endpoint that creates a job
- Jobs: Read-only (list, get) + approve/reject/cancel endpoints
- Automations: CRUD + toggle enable/disable

```bash
git commit -m "feat: add files, workflows, jobs, and automations REST API"
```

---

## Phase 4: MCP Server (Inbound)

### Task 10: MCP server setup + task tools

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools/tasks.ts`
- Test: `tests/mcp/server.test.ts`

**Step 1: Install MCP SDK**

```bash
bun add @modelcontextprotocol/sdk
```

**Step 2: Write the failing test**

```typescript
// tests/mcp/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "@/db/schema";
import { createMcpServer } from "@/mcp/server";

describe("MCP Server", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates an MCP server with task tools", () => {
    const server = createMcpServer(db);
    expect(server).toBeTruthy();
    // The server object should have tools registered
  });
});
```

**Step 3: Implement MCP server with task tools**

Refer to `@modelcontextprotocol/sdk` docs for server creation. Register tools that mirror the REST API: `create_task`, `list_tasks`, `get_task`, `update_task`, `complete_task`.

**Step 4-6:** Test, verify, commit.

```bash
git commit -m "feat: add MCP server with task management tools"
```

---

### Task 11: Entity, file, workflow, and system MCP tools

**Files:**
- Create: `src/mcp/tools/entities.ts`
- Create: `src/mcp/tools/files.ts`
- Create: `src/mcp/tools/workflows.ts`
- Create: `src/mcp/tools/system.ts`

Register all remaining MCP tools as defined in the design doc Section 7. Same TDD cycle.

```bash
git commit -m "feat: add entity, file, workflow, and system MCP tools"
```

---

## Phase 5: LLM Integration

### Task 12: Claude Agent SDK wrapper + model router

**Files:**
- Create: `src/llm/client.ts`
- Create: `src/llm/router.ts`
- Test: `tests/llm/router.test.ts`

**Step 1: Install Claude Agent SDK**

```bash
bun add @anthropic-ai/claude-agent-sdk
```

**Step 2: Write the failing test (router only — SDK calls are integration tests)**

```typescript
// tests/llm/router.test.ts
import { describe, it, expect } from "bun:test";
import { routeModel } from "@/llm/router";

describe("Model Router", () => {
  it("routes short simple prompts to haiku", () => {
    expect(routeModel("Classify this: 'hello'")).toBe("haiku");
  });

  it("routes summarization to sonnet", () => {
    const longText = "Summarize this document:\n\n" + "word ".repeat(500);
    expect(routeModel(longText)).toBe("sonnet");
  });

  it("routes complex multi-source synthesis to opus", () => {
    const complexPrompt =
      "Based on the following 5 research papers, write a comprehensive analysis:\n\n" +
      "paper ".repeat(3000);
    expect(routeModel(complexPrompt)).toBe("opus");
  });

  it("routes blog writing to opus", () => {
    expect(routeModel("Write a blog post about distributed systems")).toBe("opus");
  });

  it("routes formatting to haiku", () => {
    expect(routeModel("Format this list as bullet points: a, b, c")).toBe("haiku");
  });
});
```

**Step 3: Implement router**

```typescript
// src/llm/router.ts
type ModelTier = "haiku" | "sonnet" | "opus";

const OPUS_SIGNALS = [
  /write\s+(a\s+)?blog/i,
  /comprehensive\s+analysis/i,
  /in-depth|thorough|nuanced/i,
  /based on.*(multiple|several|\d+)\s+(sources|papers|documents)/i,
];

const HAIKU_SIGNALS = [
  /classify|categorize|tag/i,
  /format\s+(this|the)/i,
  /extract\s+(the\s+)?(name|date|email|number)/i,
  /yes\s+or\s+no/i,
  /true\s+or\s+false/i,
  /list\s+(as|the)/i,
];

export function routeModel(prompt: string): ModelTier {
  // Check explicit signals first
  if (OPUS_SIGNALS.some((r) => r.test(prompt))) return "opus";
  if (HAIKU_SIGNALS.some((r) => r.test(prompt))) return "haiku";

  // Token-count heuristic (rough: 1 token ~ 4 chars)
  const estimatedTokens = Math.ceil(prompt.length / 4);

  if (estimatedTokens < 500) return "haiku";
  if (estimatedTokens < 5000) return "sonnet";
  return "opus";
}
```

**Step 4: Implement SDK client wrapper**

```typescript
// src/llm/client.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { routeModel } from "./router";
import { createChildLogger } from "../lib/logger";

const log = createChildLogger("llm");

const MODEL_MAP = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
} as const;

interface LlmCallInput {
  system?: string;
  prompt: string;
  model?: "auto" | "haiku" | "sonnet" | "opus";
}

export async function llmCall(input: LlmCallInput): Promise<string> {
  const tier =
    input.model === "auto" || !input.model
      ? routeModel(input.prompt)
      : input.model;

  const fullPrompt = input.system
    ? `${input.system}\n\n${input.prompt}`
    : input.prompt;

  log.info({ model: tier, promptLength: input.prompt.length }, "LLM call");

  let result = "";
  for await (const message of query({
    prompt: fullPrompt,
    options: {
      model: MODEL_MAP[tier],
      maxTurns: 1,
      allowedTools: [],
    },
  })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  log.info({ model: tier, resultLength: result.length }, "LLM call complete");
  return result;
}
```

**Step 5: Run tests, verify, commit**

```bash
bun test tests/llm/
git add src/llm/ tests/llm/
git commit -m "feat: add Claude Agent SDK wrapper with smart model routing"
```

---

## Phase 6: MCP Client (Outbound) + Job Engine

### Task 13: MCP client pool + tool registry

**Files:**
- Create: `src/mcp/client/pool.ts`
- Create: `src/mcp/client/registry.ts`
- Test: `tests/mcp/client.test.ts`

Implement the outbound MCP client that connects to external MCP servers (PDF reader, Brave, Exa, GitHub, Discord). Uses `@modelcontextprotocol/sdk` Client class. The pool manages connections lazily — connects on first use, caches, reconnects on failure.

The registry reads from the `tool_registry` SQLite table and provides methods to list available tools, check health, and get client instances.

```bash
git commit -m "feat: add MCP client pool and tool registry for external servers"
```

---

### Task 14: Job queue + workflow executor

**Files:**
- Create: `src/jobs/queue.ts`
- Create: `src/jobs/executor.ts`
- Create: `src/jobs/context.ts`
- Create: `src/lib/template.ts`
- Test: `tests/jobs/queue.test.ts`
- Test: `tests/jobs/executor.test.ts`
- Test: `tests/lib/template.test.ts`

**Key components:**

1. **Template engine** (`src/lib/template.ts`): Interpolates `{{variable}}` references in workflow step inputs, using the accumulated pipeline context. Supports nested access like `{{file.name}}` and array access like `{{notes.0.title}}`.

2. **Job queue** (`src/jobs/queue.ts`): SQLite-backed. `enqueue(workflow_id, input)` creates a job. `dequeue()` picks the next queued job. `updateStatus(id, status)` transitions state. Polling loop runs every 1 second.

3. **Pipeline context** (`src/jobs/context.ts`): Accumulates variables across workflow steps via `output_mapping`. Each step's output gets mapped into named variables that subsequent steps can reference.

4. **Executor** (`src/jobs/executor.ts`): Walks through workflow steps sequentially. For each step:
   - Interpolates `{{variables}}` in the step input
   - If `trust_level === "approve"`, creates an approval record and pauses
   - If `server === "internal"`, routes to internal tools (CRUD, `llm_call`)
   - Otherwise, calls the MCP client pool to invoke the external tool
   - Maps output via `output_mapping` into the pipeline context
   - Handles timeouts, retries, and failure policies

```bash
git commit -m "feat: add job queue, workflow executor, and template engine"
```

---

### Task 15: Approval system

**Files:**
- Create: `src/jobs/approval.ts`
- Test: `tests/jobs/approval.test.ts`

Implements the approval gate:
- `createApproval(jobId, stepIndex, context, secret)` — creates approval record with HMAC token, sets job to `awaiting_approval`
- `resolveApproval(token, secret, decision)` — verifies token, updates approval status, resumes or aborts job
- Expiry check: a periodic sweep marks expired approvals and their jobs as `expired`

```bash
git commit -m "feat: add human-in-the-loop approval system with HMAC tokens"
```

---

## Phase 7: Discord + Scheduler + Notifications

### Task 16: Discord bot integration

**Files:**
- Create: `src/notifications/discord.ts`
- Test: `tests/notifications/discord.test.ts`

**Step 1: Install discord.js**

```bash
bun add discord.js
```

**Step 2: Implement Discord bot**

The bot:
- Connects using the stored bot token
- Sends notification messages to the configured channel
- For approval requests: sends an embed with Approve/Reject buttons using Discord's `ActionRowBuilder` and `ButtonBuilder`
- Listens for button interactions, extracts the approval token from the button custom ID, calls `resolveApproval`
- Sends confirmation message after approval/rejection

Test with a mock Discord client to verify message formatting and button creation logic without actually connecting to Discord.

```bash
git commit -m "feat: add Discord bot with interactive approval buttons"
```

---

### Task 17: Notification dispatcher

**Files:**
- Create: `src/notifications/dispatcher.ts`
- Test: `tests/notifications/dispatcher.test.ts`

Routes notifications to configured channels. Reads from `notification_channels` table. V1 supports `discord` type only but is structured to support additional channels later.

```bash
git commit -m "feat: add notification dispatcher"
```

---

### Task 18: Cron scheduler

**Files:**
- Create: `src/scheduler/scheduler.ts`
- Create: `src/scheduler/recurring-tasks.ts`
- Test: `tests/scheduler/scheduler.test.ts`

Uses `croner` to schedule automations. On startup, reads all enabled automations from DB, creates a `Cron` instance for each. When triggered, enqueues a job for the automation's workflow with the configured input.

`recurring-tasks.ts` handles tasks with `recurrence` field — generates new task instances when their cron expression fires.

```bash
git commit -m "feat: add cron scheduler for automations and recurring tasks"
```

---

## Phase 8: Entry Point + Setup Wizard

### Task 19: Config loading + entry point

**Files:**
- Create: `src/config.ts`
- Create: `src/index.ts`
- Test: `tests/config.test.ts`

`config.ts` loads and validates all configuration from environment variables using Zod. `index.ts` is the main entry point that:

1. Loads config
2. Initializes SQLite database
3. Derives master encryption key
4. Starts Hono HTTP server
5. Starts MCP server (stdio transport)
6. Initializes MCP client pool
7. Starts job queue polling loop
8. Starts cron scheduler
9. Connects Discord bot (if configured)
10. Logs startup summary

```bash
git commit -m "feat: add config loading and main entry point"
```

---

### Task 20: First-run setup wizard

**Files:**
- Create: `scripts/setup.ts`

Interactive CLI wizard (uses `process.stdin` / `readline`) that:
1. Creates the data directory
2. Prompts for master passphrase
3. Generates and displays the API key
4. Prompts for external service keys (Discord, Brave, Exa, GitHub)
5. Stores all secrets encrypted in the database
6. Registers MCP tool servers in the registry
7. Verifies Claude Code SDK access

```bash
git commit -m "feat: add interactive first-run setup wizard"
```

---

### Task 21: Pre-built workflow templates

**Files:**
- Create: `workflows/parse-pdf-summarize.json`
- Create: `workflows/blog-post-from-notes.json`
- Create: `workflows/daily-study-reminder.json`

Write the three example workflows from the design doc as JSON files. The setup wizard (or a `bun run seed` command) loads these into the `workflows` table.

```bash
git commit -m "feat: add pre-built workflow templates"
```

---

### Task 22: Search router

**Files:**
- Create: `src/lib/search-router.ts`
- Test: `tests/lib/search-router.test.ts`

Implements the Brave vs Exa routing logic. Tests verify that routine queries go to Brave and research/semantic queries go to Exa.

```bash
git commit -m "feat: add smart search routing (Brave free / Exa deep)"
```

---

## Phase 9: Integration + Polish

### Task 23: End-to-end integration test

**Files:**
- Create: `tests/integration/workflow.test.ts`

Test a full workflow lifecycle:
1. Register a workflow via REST
2. Trigger it with input
3. Verify job is created and progresses through steps
4. Verify approval gate pauses the job
5. Approve via REST
6. Verify job completes

Uses mock MCP servers (in-process) to avoid external dependencies.

```bash
git commit -m "test: add end-to-end workflow integration test"
```

---

### Task 24: MCP server config for Claude Code

**Files:**
- Create: `humanoms.mcp.json`

Create the MCP server configuration file so users can add HumanOMS to their Claude Code config:

```json
{
  "mcpServers": {
    "humanoms": {
      "command": "bun",
      "args": ["run", "/path/to/humanoms/src/index.ts", "--mcp"],
      "env": {
        "HUMANOMS_DB_PATH": "./data/humanoms.db",
        "HUMANOMS_MASTER_KEY": "${HUMANOMS_MASTER_KEY}"
      }
    }
  }
}
```

```bash
git commit -m "feat: add MCP server config for Claude Code integration"
```

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1. Scaffolding + DB | 1-3 | Project init, SQLite schema, shared utilities |
| 2. Security | 4-5 | Encryption, secrets, auth, audit, tokens |
| 3. REST API | 6-9 | Hono server, middleware, all CRUD routes |
| 4. MCP Server | 10-11 | Inbound MCP server with all tools |
| 5. LLM | 12 | Claude Agent SDK + model router |
| 6. Job Engine | 13-15 | MCP client pool, job queue, executor, approvals |
| 7. Discord + Scheduler | 16-18 | Discord bot, notifications, cron scheduler |
| 8. Entry Point | 19-21 | Config, main entry, setup wizard, workflow templates |
| 9. Integration | 22-24 | Search router, e2e tests, MCP config |

**Total: 24 tasks across 9 phases.**
