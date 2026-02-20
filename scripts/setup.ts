#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * HumanOMS First-Run Setup Wizard
 *
 * Interactive CLI that:
 * 1. Creates the data directory
 * 2. Prompts for master passphrase
 * 3. Generates and displays the API key
 * 4. Prompts for external service keys
 * 5. Stores secrets encrypted in the database
 * 6. Registers MCP tool servers in the registry
 */

import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import { Database } from "bun:sqlite";
import { applySchema } from "../src/db/schema.ts";
import { deriveKey } from "../src/security/encryption.ts";
import { SecretStore } from "../src/security/secrets.ts";
import { generateApiKey } from "../src/security/auth.ts";
import { generateId } from "../src/lib/ulid.ts";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askSecret(question: string): Promise<string> {
  return ask(question);
}

async function main() {
  console.log("\n  HumanOMS Setup Wizard\n");
  console.log("  This will configure your local HumanOMS instance.\n");

  // Step 1: Data directory
  const defaultDataDir = resolve(process.cwd(), "data");
  const dataDir = (await ask(`  Data directory [${defaultDataDir}]: `)) || defaultDataDir;

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`  Created: ${dataDir}`);
  } else {
    console.log(`  Exists: ${dataDir}`);
  }

  const dbPath = resolve(dataDir, "humanoms.db");

  // Step 2: Master passphrase
  console.log("");
  const passphrase = await askSecret(
    "  Master passphrase (encrypts all secrets): "
  );
  if (!passphrase) {
    console.error("\n  Error: passphrase is required.");
    process.exit(1);
  }
  console.log("  Passphrase accepted.");

  // Initialize database
  const db = new Database(dbPath, { create: true });
  applySchema(db);
  console.log(`  Database initialized: ${dbPath}`);

  // Derive master key
  const masterKey = deriveKey(passphrase, "humanoms-master-salt");
  const secrets = new SecretStore(db, masterKey);

  // Step 3: Generate API key
  console.log("");
  const { raw: apiKey, hash: apiKeyHash } = await generateApiKey();
  secrets.set("api_key_hash", apiKeyHash);
  console.log("  API Key generated. Save this — it won't be shown again:");
  console.log(`\n    ${apiKey}\n`);

  // Step 4: External service keys
  console.log("  Optional: Configure external services (press Enter to skip)\n");

  const discordToken = await askSecret("  Discord bot token: ");
  if (discordToken) {
    secrets.set("discord_bot_token", discordToken);
    console.log("  Stored.");
  }

  const discordChannelId = await ask("  Discord channel ID: ");
  if (discordChannelId) {
    secrets.set("discord_channel_id", discordChannelId);
    console.log("  Stored.");
  }

  const braveApiKey = await askSecret("  Brave Search API key: ");
  if (braveApiKey) {
    secrets.set("brave_api_key", braveApiKey);
    console.log("  Stored.");
  }

  const exaApiKey = await askSecret("  Exa API key: ");
  if (exaApiKey) {
    secrets.set("exa_api_key", exaApiKey);
    console.log("  Stored.");
  }

  const githubToken = await askSecret("  GitHub personal access token: ");
  if (githubToken) {
    secrets.set("github_token", githubToken);
    console.log("  Stored.");
  }

  // NOTE: No Anthropic API key needed — LLM calls use the Claude Agent SDK
  // which runs through your Claude Max subscription automatically.

  // Step 5: Register default MCP tool servers
  console.log("\n  Registering MCP tool servers...\n");

  const defaultServers = [
    {
      name: "brave-search",
      transport: "stdio",
      config: {
        command: "npx",
        args: ["-y", "@anthropic-ai/brave-search-mcp"],
      },
      capabilities: ["web_search"],
    },
    {
      name: "github",
      transport: "stdio",
      config: {
        command: "npx",
        args: ["-y", "@anthropic-ai/github-mcp"],
      },
      capabilities: [
        "create_issue",
        "create_pull_request",
        "push_files",
      ],
    },
  ];

  for (const server of defaultServers) {
    db.query(
      `INSERT OR IGNORE INTO tool_registry (id, name, transport, config, capabilities)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      generateId(),
      server.name,
      server.transport,
      JSON.stringify(server.config),
      JSON.stringify(server.capabilities)
    );
    console.log(`    ${server.name}`);
  }

  // Step 6: Write .env file (skip in Docker — env vars come from docker-compose.yml)
  // NOTE: API key hash is stored ONLY in the database (via SecretStore above).
  // Bun's .env parser expands $ even inside quotes, which destroys Argon2 hashes.
  const envContent = `# HumanOMS Configuration
HUMANOMS_PORT=3747
HUMANOMS_HOST=localhost
HUMANOMS_DB_PATH=${dbPath}
HUMANOMS_MASTER_KEY=${passphrase}
HUMANOMS_LOG_LEVEL=info
`;

  const envPath = resolve(process.cwd(), ".env");
  try {
    await Bun.write(envPath, envContent);
    console.log(`\n  Generated .env: ${envPath}`);
  } catch {
    console.log("\n  Skipped .env generation (read-only filesystem — normal in Docker).");
  }

  // Done
  db.close();
  console.log("\n  Setup complete!\n");

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
