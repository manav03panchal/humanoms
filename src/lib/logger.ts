import pino from "pino";

export const logger = pino({
  level: process.env.HUMANOMS_LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
