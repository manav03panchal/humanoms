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
  chatProvider: z.enum(["anthropic", "openai", "claude-code"]).default("anthropic"),
  chatApiKey: z.string().optional(),
  chatBaseUrl: z.string().optional(),
  chatModel: z.string().optional(),
  chatMaxTokens: z.coerce.number().int().positive().optional(),
});

export type Config = z.infer<typeof ConfigSchema> & { masterKey: string };

export function loadConfig(): Config {
  // Filter out empty-string env vars so Zod treats them as undefined
  const env = (v: string | undefined) => (v === "" ? undefined : v);

  const raw = ConfigSchema.parse({
    port: env(process.env.HUMANOMS_PORT),
    host: env(process.env.HUMANOMS_HOST),
    dbPath: env(process.env.HUMANOMS_DB_PATH),
    masterKey: env(process.env.HUMANOMS_MASTER_KEY),
    logLevel: env(process.env.HUMANOMS_LOG_LEVEL),
    chatProvider: env(process.env.CHAT_PROVIDER),
    chatApiKey: env(process.env.CHAT_API_KEY) || env(process.env.ANTHROPIC_API_KEY) || env(process.env.OPENAI_API_KEY),
    chatBaseUrl: env(process.env.CHAT_BASE_URL),
    chatModel: env(process.env.CHAT_MODEL),
    chatMaxTokens: env(process.env.CHAT_MAX_TOKENS),
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
