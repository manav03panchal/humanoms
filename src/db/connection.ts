import { Database } from "bun:sqlite";
import { applySchema } from "./schema";

let db: Database | null = null;

export function initDb(dbPath: string): Database {
  db = new Database(dbPath, { create: true });
  applySchema(db);
  return db;
}

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
