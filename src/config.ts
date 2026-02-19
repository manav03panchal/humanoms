import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3747),
  host: z.string().default("localhost"),
  dbPath: z.string().default("./data/humanoms.db"),
  masterKey: z.string().min(1, "HUMANOMS_MASTER_KEY is required"),
  apiKeyHash: z.string().optional(),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    port: process.env.HUMANOMS_PORT,
    host: process.env.HUMANOMS_HOST,
    dbPath: process.env.HUMANOMS_DB_PATH,
    masterKey: process.env.HUMANOMS_MASTER_KEY,
    apiKeyHash: process.env.HUMANOMS_API_KEY_HASH,
    logLevel: process.env.HUMANOMS_LOG_LEVEL,
  });
}
