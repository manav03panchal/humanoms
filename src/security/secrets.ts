import type { Database } from "bun:sqlite";
import { generateId } from "../lib/ulid";
import { decrypt, encrypt } from "./encryption";

export class SecretStore {
  private db: Database;
  private masterKey: Buffer;

  constructor(db: Database, masterKey: Buffer) {
    this.db = db;
    this.masterKey = masterKey;
  }

  /**
   * Encrypt and upsert a secret value by key name.
   */
  set(key: string, value: string): void {
    const encryptedValue = encrypt(value, this.masterKey);
    const existing = this.db
      .query<{ id: string }, [string]>("SELECT id FROM secrets WHERE key = ?")
      .get(key);

    if (existing) {
      this.db
        .query("UPDATE secrets SET encrypted_value = ?, updated_at = datetime('now') WHERE key = ?")
        .run(encryptedValue, key);
    } else {
      const id = generateId();
      this.db
        .query(
          "INSERT INTO secrets (id, key, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
        )
        .run(id, key, encryptedValue);
    }
  }

  /**
   * Retrieve and decrypt a secret by key name. Returns null if not found.
   */
  get(key: string): string | null {
    const row = this.db
      .query<{ encrypted_value: string }, [string]>(
        "SELECT encrypted_value FROM secrets WHERE key = ?"
      )
      .get(key);

    if (!row) return null;

    return decrypt(row.encrypted_value, this.masterKey);
  }

  /**
   * Delete a secret by key name.
   */
  delete(key: string): void {
    this.db.query("DELETE FROM secrets WHERE key = ?").run(key);
  }

  /**
   * List all secret key names (values are never exposed).
   */
  list(): string[] {
    const rows = this.db
      .query<{ key: string }, []>("SELECT key FROM secrets ORDER BY key")
      .all();

    return rows.map((row) => row.key);
  }
}
