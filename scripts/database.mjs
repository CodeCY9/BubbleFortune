import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CONTAINER_NAME = 'bubble-fortune-postgres';
const PORT = 15434;
const DB_NAME = 'bubble_fortune';
const DB_USER = 'bubble_fortune';
const NAMED_VOLUME = 'bubble-fortune-postgres-data';

function isDockerRunning() {
  try {
    const res = spawnSync('docker', ['info'], { stdio: 'pipe' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function containerExists() {
  try {
    const res = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (res.status !== 0 || !res.stdout) return false;
    return res.stdout.trim().split(/\r?\n/).includes(CONTAINER_NAME);
  } catch {
    return false;
  }
}

function isContainerRunning() {
  try {
    const res = spawnSync('docker', ['ps', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (res.status !== 0 || !res.stdout) return false;
    return res.stdout.trim().split(/\r?\n/).includes(CONTAINER_NAME);
  } catch {
    return false;
  }
}

function waitForPostgresReady(maxSeconds = 15) {
  for (let i = 0; i < maxSeconds; i++) {
    const res = spawnSync('docker', ['exec', CONTAINER_NAME, 'pg_isready', '-d', DB_NAME], {
      stdio: 'pipe'
    });
    if (res.status === 0) {
      return true;
    }
    spawnSync(process.platform === 'win32' ? 'powershell' : 'sleep', process.platform === 'win32' ? ['-Command', 'Start-Sleep -Milliseconds 1000'] : ['1'], { stdio: 'pipe' });
  }
  return false;
}

export function getOrGenerateDbPassword(customSecretPath) {
  const secretFile = customSecretPath || path.resolve('.env.database.local');
  if (fs.existsSync(secretFile)) {
    let content;
    try {
      content = fs.readFileSync(secretFile, 'utf8');
    } catch {
      throw new Error('Failed to read existing .env.database.local');
    }
    const match = content.match(/^(?:POSTGRES_PASSWORD|DB_PASSWORD)=([^\r\n]+)/m);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
    // Existing file lacks recognized password: throw generic error and never overwrite
    throw new Error('Unrecognized database credentials format in existing .env.database.local');
  }

  const newPassword = crypto.randomBytes(32).toString('hex');
  const config = `POSTGRES_DB=${DB_NAME}\nPOSTGRES_USER=${DB_USER}\nPOSTGRES_PASSWORD=${newPassword}\n`;
  try {
    fs.writeFileSync(secretFile, config, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new Error('Failed to securely initialize .env.database.local');
  }
  return newPassword;
}

async function main() {
  const action = (process.argv[2] || 'up').toLowerCase();
  if (action !== 'up' && action !== 'setup') {
    console.error('[database] Invalid action. Only "up" and "setup" are supported.');
    process.exit(1);
  }

  console.log(`[database] Action: ${action}`);

  if (!isDockerRunning()) {
    console.error('[database] ERROR: Docker daemon is not accessible. Please ensure Docker Desktop/daemon is running.');
    process.exit(1);
  }

  if (containerExists()) {
    if (isContainerRunning()) {
      console.log(`[database] Container "${CONTAINER_NAME}" is already running on 127.0.0.1:${PORT}.`);
    } else {
      console.log(`[database] Starting existing container "${CONTAINER_NAME}"...`);
      const startRes = spawnSync('docker', ['start', CONTAINER_NAME], { stdio: 'inherit' });
      if (startRes.status !== 0) {
        console.error('[database] Failed to start Docker container. Please check Docker permissions.');
        process.exit(1);
      }
      console.log(`[database] Container "${CONTAINER_NAME}" started.`);
    }

    const ready = waitForPostgresReady(15);
    if (!ready) {
      console.error('[database] Timed out waiting for PostgreSQL to become ready.');
      process.exit(1);
    }
  } else {
    // New container creation: use secure password and named volume
    const password = getOrGenerateDbPassword();
    console.log(`[database] Creating container "${CONTAINER_NAME}" (postgres:16 on 127.0.0.1:${PORT})...`);

    const runRes = spawnSync('docker', [
      'run', '-d',
      '--name', CONTAINER_NAME,
      '-p', `127.0.0.1:${PORT}:5432`,
      '-v', `${NAMED_VOLUME}:/var/lib/postgresql/data`,
      '-e', `POSTGRES_DB=${DB_NAME}`,
      '-e', `POSTGRES_USER=${DB_USER}`,
      '-e', `POSTGRES_PASSWORD=${password}`,
      'postgres:16'
    ], { stdio: 'pipe' });

    if (runRes.status !== 0) {
      console.error('[database] Failed to create Docker container. Please check Docker daemon permissions.');
      process.exit(1);
    }

    const ready = waitForPostgresReady(20);
    if (!ready) {
      console.error('[database] Timed out waiting for PostgreSQL to become ready.');
      process.exit(1);
    }

    const envLocalPath = path.resolve('.env.local');
    if (!fs.existsSync(envLocalPath)) {
      const connUrl = `postgresql://${DB_USER}:${password}@127.0.0.1:${PORT}/${DB_NAME}`;
      fs.writeFileSync(envLocalPath, `DATABASE_URL=${connUrl}\nPORT=2567\nHOST=0.0.0.0\nPUBLIC_ORIGIN=http://localhost:3000\n`, 'utf8');
      console.log('[database] Generated .env.local with DATABASE_URL.');
    }
  }

  // Check .env.local status
  const envLocalPath = path.resolve('.env.local');
  if (fs.existsSync(envLocalPath)) {
    try {
      const content = fs.readFileSync(envLocalPath, 'utf8');
      if (content.includes('DATABASE_URL=')) {
        console.log('[database] .env.local configured with DATABASE_URL. Database service ready.');
      } else {
        console.log('[database] Warning: .env.local exists but lacks DATABASE_URL.');
      }
    } catch {
      console.log('[database] .env.local detected.');
    }
  } else {
    console.log('[database] Note: .env.local does not exist. Ensure DATABASE_URL is set in your environment.');
  }
}

main().catch(() => {
  console.error('[database] Unexpected error during database management.');
  process.exit(1);
});
