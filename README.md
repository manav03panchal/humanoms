# HumanOMS

Personal operations system. Chat-driven task management, workflow automation, and scheduled jobs with Discord notifications.

**Stack:** Bun + Hono + SQLite + any LLM (Anthropic, OpenAI, DeepSeek, Groq, Kimi, Ollama, etc.)

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

# Pick your AI provider
CHAT_PROVIDER=anthropic
CHAT_API_KEY=sk-ant-your-key-here
```

### 2. Build and run

```bash
docker compose up -d --build
```

### 3. Set up login

Generate an API key for the web UI:

```bash
docker exec humanoms-humanoms-1 bun run scripts/setup-api-key.ts
```

This prints a `homs_...` key. **Save it** -- it's shown once and can't be recovered. Paste it into the login screen.

### 4. Open

```
http://localhost:3747
```

Or from another device on your network: `http://<machine-ip>:3747`

## AI Providers

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

## Discord Notifications (Optional)

For workflow approval buttons and job notifications:

1. Create a Discord bot at https://discord.com/developers/applications
2. Enable **Message Content Intent** under Bot settings
3. Invite it to your server with `bot` + `applications.commands` scopes
4. Store the credentials:

```bash
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts discord_bot_token "your-bot-token"
docker exec humanoms-humanoms-1 bun run scripts/add-secret.ts discord_channel_id "your-channel-id"
```

5. Restart: `docker compose restart`

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
cp .env.example .env   # edit with your values
bun run index.ts
```

Tests:

```bash
bun test
```

## PWA

HumanOMS serves a PWA manifest. On mobile, open the URL in your browser and tap "Add to Home Screen" for an app-like experience.
