import { z } from "zod";
import crypto from "crypto";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3747),
  host: z.string().default("localhost"),
  dbPath: z.string().default("./data/humanoms.db"),
  masterKey: z.string().optional(),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Config = z.infer<typeof ConfigSchema> & { masterKey: string };

export function loadConfig(): Config {
  const raw = ConfigSchema.parse({
    port: process.env.HUMANOMS_PORT,
    host: process.env.HUMANOMS_HOST,
    dbPath: process.env.HUMANOMS_DB_PATH,
    masterKey: process.env.HUMANOMS_MASTER_KEY,
    logLevel: process.env.HUMANOMS_LOG_LEVEL,
  });

  let masterKey = raw.masterKey;
  if (!masterKey) {
    masterKey = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[config] WARNING: HUMANOMS_MASTER_KEY not set. Generated a random key for this session. Set HUMANOMS_MASTER_KEY in your environment for persistent approval tokens."
    );
  }

  return { ...raw, masterKey } as Config;
}
