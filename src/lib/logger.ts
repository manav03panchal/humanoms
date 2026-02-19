import pino from "pino";

export const logger = pino({
  level: process.env.HUMANOMS_LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
