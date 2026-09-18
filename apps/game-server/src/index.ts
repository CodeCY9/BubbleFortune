import fs from 'node:fs';
import path from 'node:path';
import { createAppServer } from './server';

// Load .env.local if present. If malformed, fail fast with generic startup message without leaking sensitive strings
const envLocalPath = path.resolve('.env.local');
if (fs.existsSync(envLocalPath) && typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile(envLocalPath);
  } catch {
    console.error('[game-server] Fatal: .env.local file exists but failed to parse. Check file syntax.');
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT) || 2567;
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;

async function main() {
  const app = createAppServer({
    databaseUrl: DATABASE_URL,
    publicOrigins: PUBLIC_ORIGIN ? [PUBLIC_ORIGIN] : undefined
  });
  const actualPort = await app.listen(PORT, HOST);
  console.log(`[game-server] BubbleFortune Classic 26 Server listening on http://${HOST}:${actualPort}`);

  const shutdown = async () => {
    console.log('[game-server] Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  const code = (err && (err.code || err.name)) || 'STARTUP_ERROR';
  console.error('[game-server] Startup failed with error code:', code);
  if (code === 'ECONNREFUSED') {
    console.error('[game-server] Database connection refused. Start PostgreSQL or remove DATABASE_URL for no-database local mode.');
  }
  process.exit(1);
});
