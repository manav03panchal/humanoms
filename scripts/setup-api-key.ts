#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * Generate an API key and store its hash in the secret store.
 *
 * Usage:
 *   bun run scripts/setup-api-key.ts
 *
 * Prints the raw key once — save it, it cannot be recovered.
 */
import { Database } from "bun:sqlite";
import { deriveKey } from "../src/security/encryption.ts";
import { SecretStore } from "../src/security/secrets.ts";
import { generateApiKey } from "../src/security/auth.ts";

const dbPath = process.env.HUMANOMS_DB_PATH || "./data/humanoms.db";
const masterKey = process.env.HUMANOMS_MASTER_KEY || "dev-insecure-key";

const db = new Database(dbPath);
const keyBuffer = deriveKey(masterKey, "humanoms-master-salt");
const secrets = new SecretStore(db, keyBuffer);

const { raw, hash } = await generateApiKey();
secrets.set("api_key_hash", hash);

console.log(`\n  API key generated and stored.\n`);
console.log(`  Your key (save this — shown once):\n`);
console.log(`    ${raw}\n`);

db.close();
