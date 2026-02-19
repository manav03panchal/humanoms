#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * Add or update a secret in the encrypted secret store.
 *
 * Usage:
 *   bun run scripts/add-secret.ts <key> <value>
 *
 * Example:
 *   bun run scripts/add-secret.ts anthropic_api_key sk-ant-...
 */
import { Database } from "bun:sqlite";
import { deriveKey } from "../src/security/encryption.ts";
import { SecretStore } from "../src/security/secrets.ts";

const [key, value] = process.argv.slice(2);

if (!key || !value) {
  console.error("Usage: bun run scripts/add-secret.ts <key> <value>");
  process.exit(1);
}

const dbPath = process.env.HUMANOMS_DB_PATH || "./data/humanoms.db";
const masterKey = process.env.HUMANOMS_MASTER_KEY || "dev-insecure-key";

const db = new Database(dbPath);
const keyBuffer = deriveKey(masterKey, "humanoms-master-salt");
const secrets = new SecretStore(db, keyBuffer);

secrets.set(key, value);
console.log(`  Stored secret: ${key}`);

db.close();
