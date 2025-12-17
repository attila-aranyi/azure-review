import pino from "pino";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["ADO_PAT", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      remove: true
    }
  });
}

