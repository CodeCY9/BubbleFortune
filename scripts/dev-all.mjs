import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const node = process.execPath;

console.log('[launcher] Starting local PostgreSQL...');
const db = spawnSync(node, ['scripts/database.mjs', 'up'], { stdio: 'inherit' });
if (db.error || db.status !== 0) {
  console.error('[launcher] Database startup failed.');
  if (db.error) console.error(`[launcher] ${db.error.message}`);
  process.exit(db.status ?? 1);
}

const app = spawn(node, [path.resolve('scripts/dev.mjs')], { stdio: 'inherit' });
const stop = () => {
  if (app.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(app.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      app.kill('SIGTERM');
    }
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', (code) => process.exit(code ?? 1));
