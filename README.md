# HumanOMS

Personal operations system. Chat-driven task management, workflow automation, and scheduled jobs with Discord notifications.

**Stack:** Bun + Hono + SQLite + any LLM (Claude Max, Anthropic, OpenAI, DeepSeek, Groq, Kimi, Ollama, etc.)

## Quick Start (Docker)

```bash
git clone https://github.com/manav03panchal/humanoms.git
cd humanoms
```

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Required
HUMANOMS_MASTER_KEY=some-strong-passphrase-here

# Pick your AI provider (see "AI Providers" below)
CHAT_PROVIDER=claude-code
```

### 2. Authenticate (claude-code provider only)

If using `CHAT_PROVIDER=claude-code` (the default), authenticate the Claude Code CLI on your host machine first:

```bash
npx @anthropic-ai/claude-code claude login
```

This opens a browser for OAuth. Once authenticated, credentials are stored in `~/.claude/` and `~/.claude.json`. The Docker container mounts these files automatically -- no API key needed.

> **Note:** This requires an active [Claude Max](https://claude.ai/pricing) subscription. If you don't have one, use `anthropic` or `openai` provider with an API key instead.

### 3. Build and run

```bash
docker compose up -d --build
```

### 4. Run the setup wizard

The interactive wizard generates your API key and lets you configure all integrations in one go:

```bash
docker exec -it humanoms-humanoms-1 bun run scripts/setup.ts
```

It walks you through:
- **Master passphrase** -- encrypts all secrets in the database
- **API key** -- for the web UI login (printed once, save it)
- **Discord** -- bot token + channel ID for workflow approvals and notifications
- **Brave Search** -- API key for web search tools
- **Exa** -- API key for semantic search
- **GitHub** -- personal access token for repo operations (issues, PRs, pushes)

It also registers MCP tool servers (Brave Search, GitHub) in the tool registry.

Press Enter to skip any integration you don't need -- you can always add them later:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts <key> <value>
```

Available secret keys: `discord_bot_token`, `discord_channel_id`, `brave_api_key`, `exa_api_key`, `github_token`

### 5. Open

```
http://localhost:3747
```

Or from another device on your network: `http://<machine-ip>:3747`

## AI Providers

### Claude Max (no API key)

Set `CHAT_PROVIDER=claude-code`. Uses the Claude Code Agent SDK with your OAuth credentials from `claude login` -- no API cost beyond your Max subscription.

```env
CHAT_PROVIDER=claude-code
```

The Docker container mounts `~/.claude/` and `~/.claude.json` from your host and runs as your host user (so file permissions match). These mounts are read-write because the CLI writes temp/session files.

### API-key providers

Any provider that speaks OpenAI's API format works out of the box. Set these in `.env`:

| Provider | `CHAT_PROVIDER` | `CHAT_API_KEY` | `CHAT_BASE_URL` | `CHAT_MODEL` |
|----------|----------------|----------------|------------------|--------------|
| Anthropic | `anthropic` | `sk-ant-...` | -- | `claude-sonnet-4-6` |
| OpenAI | `openai` | `sk-...` | -- | `gpt-4o` |
| DeepSeek | `openai` | `sk-...` | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Groq | `openai` | `gsk_...` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Kimi | `openai` | `sk-...` | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Ollama | `openai` | `ollama` | `http://localhost:11434/v1` | `llama3.2` |
| OpenRouter | `openai` | `sk-or-...` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` |

For Ollama, install it on the host first (`curl -fsSL https://ollama.com/install.sh | sh && ollama pull llama3.2`), then set `CHAT_BASE_URL` to your host IP (not `localhost` from inside Docker -- use `http://host.docker.internal:11434/v1` on Docker Desktop, or your machine's LAN IP).

## Integrations

All integrations are configured through the setup wizard (`bun run scripts/setup.ts`) or individually via `bun run scripts/add-secret.ts`. Secrets are encrypted with your master passphrase and stored in SQLite.

### Discord

Workflow approval buttons and job notifications.

1. Create a bot at https://discord.com/developers/applications
2. Enable **Message Content Intent** under Bot settings
3. Invite to your server with `bot` + `applications.commands` scopes
4. Add credentials:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts discord_bot_token "your-bot-token"
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts discord_channel_id "your-channel-id"
```

5. Restart: `docker compose restart`

### GitHub

Create issues, pull requests, and push files through chat.

1. Generate a PAT at https://github.com/settings/tokens with the scopes you need (e.g. `repo`, `issues`)
2. Add it:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts github_token "ghp_your-token"
```

The setup wizard also registers the `@anthropic-ai/github-mcp` tool server automatically.

### Brave Search

Web search capability for the AI.

1. Get an API key at https://brave.com/search/api
2. Add it:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts brave_api_key "your-key"
```

### Exa

Semantic/neural web search.

1. Get an API key at https://exa.ai
2. Add it:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts exa_api_key "your-key"
```

## Features

**Chat** -- talk to it like a person. It manages tasks, entities, workflows, and files through natural language. Tool calls are shown in collapsible blocks.

**Dashboard** -- live overview of pending/overdue tasks, running jobs, active automations, and recent activity.

**Workflows** -- multi-step automation pipelines. Each step can be `auto` (run immediately), `approve` (pause for Discord approval), or `notify` (send notification, keep going).

**Automations** -- cron-scheduled workflow triggers. `0 9 * * MON` runs every Monday at 9am.

**Full CRUD** -- tasks, entities, workflows, jobs, automations. Bulk delete. Cascade deletes (workflow delete removes its jobs, automations, and approvals).

**System tools** -- the AI can read/write files, run shell commands, fetch URLs, and search the web.

## Updating

```bash
cd humanoms
git pull
docker compose up -d --build
```

Data persists in the `humanoms-data` Docker volume. Rebuilds don't touch it.

## Local Development (no Docker)

Requires [Bun](https://bun.sh):

```bash
bun install
bun run scripts/setup.ts   # interactive wizard — sets up .env, API key, and integrations
bun run src/index.ts
```

For the `claude-code` provider, make sure you've run `claude login` first (comes with Claude Code CLI).

Tests:

```bash
bun test
```

## PWA

HumanOMS serves a PWA manifest. On mobile, open the URL in your browser and tap "Add to Home Screen" for an app-like experience.
