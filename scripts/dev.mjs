import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, host);
  });
}

async function main() {
  console.log('[launcher] Checking port availability for server (2567) and web (3000)...');
  const serverPortFree = await checkPort(2567);
  if (!serverPortFree) {
    console.error('[launcher] ERROR: Port 2567 is already in use. Please terminate existing server process.');
    process.exit(1);
  }

  const webPortFree = await checkPort(3000);
  if (!webPortFree) {
    console.error('[launcher] ERROR: Port 3000 is already in use. Please terminate existing web process.');
    process.exit(1);
  }

  const isWindows = process.platform === 'win32';
  const nodeExec = process.execPath;
  const serverEntry = path.resolve('apps/game-server/src/index.ts');
  const viteEntry = path.resolve('node_modules/vite/bin/vite.js');

  console.log('[launcher] Starting Game Server on port 2567 via node...');
  const serverProc = spawn(nodeExec, ['--import', 'tsx', serverEntry], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '2567', HOST: '127.0.0.1' }
  });

  console.log('[launcher] Starting Vite on port 3000 via node...');
  const webProc = spawn(nodeExec, [viteEntry, '--port', '3000', '--strictPort', '--host'], {
    stdio: 'inherit',
    env: process.env
  });

  let shuttingDown = false;
  let exitCode = 0;

  const killProc = (proc) => {
    if (!proc || !proc.pid) return;
    try {
      if (isWindows) {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {}
  };

  const shutdown = (reason, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (code !== 0 && exitCode === 0) {
      exitCode = code;
    }
    console.log(`\n[launcher] Shutting down child processes (reason: ${reason})...`);
    killProc(serverProc);
    killProc(webProc);
    process.exit(exitCode);
  };

  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));

  serverProc.on('error', (err) => {
    console.error('[launcher] Server failed to start:', err);
    shutdown('SERVER_ERROR', 1);
  });

  webProc.on('error', (err) => {
    console.error('[launcher] Vite failed to start:', err);
    shutdown('VITE_ERROR', 1);
  });

  serverProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[launcher] Server exited unexpectedly with code ${code}`);
      shutdown('SERVER_EXIT', code !== 0 ? (code ?? 1) : 1);
    }
  });

  webProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[launcher] Vite exited unexpectedly with code ${code}`);
      shutdown('WEB_EXIT', code !== 0 ? (code ?? 1) : 1);
    }
  });
}

main().catch((err) => {
  console.error('[launcher] Unexpected launcher error:', err);
  process.exit(1);
});
