// Configuration from .env (git-ignored) with safe defaults.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: num(process.env.PORT, 8080),
  dev: process.env.NODE_ENV === 'development',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:14b',
  townTz: process.env.TOWN_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  /** Development only: makes walking, activities, needs and weather run faster. The clock stays real. */
  simSpeed: Math.max(1, num(process.env.SIM_SPEED, 1)),
  maxClients: num(process.env.MAX_CLIENTS, 500),
  maxClientsPerIp: num(process.env.MAX_CLIENTS_PER_IP, 8),
};
