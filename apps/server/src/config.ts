import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().min(1).default("127.0.0.1"),
  CORS_ORIGINS: z.string().default(""),
  EGRESS_DISABLED_FILE: z.string().min(1).default("/var/lib/scrum-poker/egress-disabled"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  corsOrigins: string[];
  egressDisabledFile: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    egressDisabledFile: parsed.EGRESS_DISABLED_FILE,
  };
}

export { ConfigSchema };
