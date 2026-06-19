import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_PREFIX: z.string().default('.'),
  PORT: z.string().transform(Number).default('3001'),
  HANDLE_SELF_MESSAGES: z.string().transform((value) => value === 'true').default('true'),
  HANDLE_INCOMING_MESSAGES: z.string().transform((value) => value === 'true').default('true'),
  OWNER_NUMBER: z.string().optional(),
  OWNER_NAME: z.string().default('Owner'),
  DASHBOARD_URL: z.string().default('http://localhost:3001'),
  SCRIPT_URL: z.string().optional(),
  DONATE_TEXT: z.string().optional(),
  RULES_TEXT: z.string().optional(),
  SESSION_PATH: z.string().default('./sessions'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
});

export const config = ConfigSchema.parse(process.env);

export default config;
