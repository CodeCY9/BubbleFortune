import http from 'node:http';
import path from 'node:path';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Classic26Room } from './room/Classic26Room';
import { DuelRoom } from './room/DuelRoom';
import { AuctionRoom } from './room/AuctionRoom';
import { Challenge26Room } from './room/Challenge26Room';
import { SurvivorRoom } from './room/SurvivorRoom';
import { TournamentRoom } from './room/TournamentRoom';
import { DatabaseManager } from './persistence/db';
import { OutboxManager } from './persistence/outbox';
import { createHttpHandler } from './http/router';

export interface AppServerOptions {
  port?: number;
  host?: string;
  server?: http.Server;
  databaseUrl?: string;
  outboxDir?: string;
  publicOrigins?: string[];
  schema?: string;
}

export function createAppServer(options: AppServerOptions = {}) {
  // Allowed origins configuration
  const allowedOrigins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ]);
  const addOrigin = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    allowedOrigins.add(trimmed);
    const withoutSlash = trimmed.replace(/\/+$/, '');
    allowedOrigins.add(withoutSlash);
    try {
      const u = new URL(withoutSlash);
      allowedOrigins.add(u.origin);
    } catch {}
  };
  if (process.env.PUBLIC_ORIGIN) {
    addOrigin(process.env.PUBLIC_ORIGIN);
  }
  if (process.env.ALLOWED_ORIGINS) {
    for (const origin of process.env.ALLOWED_ORIGINS.split(',')) {
      addOrigin(origin);
    }
  }
  if (options.publicOrigins) {
    for (const origin of options.publicOrigins) {
      addOrigin(origin);
    }
  }

  const httpServer = options.server || http.createServer();
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 16 * 1024,
    verifyClient: (info, callback) => {
      try {
        const hostHeader = info.req.headers.host || '127.0.0.1';
        const parsedURL = new URL(info.req.url || '', `http://${hostHeader}`);
        const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        const roomId = processAndRoomId && processAndRoomId[1];
        const room = roomId ? matchMaker.getLocalRoomById(roomId) : undefined;
        if (room instanceof DuelRoom || room instanceof AuctionRoom || room instanceof TournamentRoom) {
          const ok = room.verifyClientUpgrade(info.req, allowedOrigins);
          if (!ok) {
            callback(false, 401, 'Unauthorized');
            return;
          }
        }
        callback(true);
      } catch {
        callback(false, 400, 'Bad Request');
      }
    }
  });

  const gameServer = new Server({
    transport
  });

  let persistenceManager: DatabaseManager | undefined;
  let outboxManager: OutboxManager | undefined;

  if (options.databaseUrl) {
    persistenceManager = new DatabaseManager({
      connectionString: options.databaseUrl,
      schema: options.schema
    });

    const defaultOutboxDir = path.resolve('.data/history-outbox');
    outboxManager = new OutboxManager({
      dir: options.outboxDir || defaultOutboxDir,
      db: persistenceManager
    });
  }

  let initPromise: Promise<void> | null = null;
  const ensureInit = () => {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          if (persistenceManager) {
            await persistenceManager.init();
          }
          if (outboxManager) {
            await outboxManager.init();
          }
        } catch (err) {
          initPromise = null; // Reset so next request can retry initialization
          throw err;
        }
      })();
    }
    return initPromise;
  };

  // Attach HTTP API handler
  const apiHandler = createHttpHandler({
    db: persistenceManager,
    allowedOrigins
  });

  httpServer.on('request', async (req, res) => {
    try {
      const urlStr = req.url || '';
      const healthPath = urlStr.split('?', 1)[0];

      // Keep liveness independent from PostgreSQL so the process can be
      // restarted by the orchestrator while the database is recovering.
      if (req.method === 'GET' && healthPath === '/healthz') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({ status: 'ok', service: 'game-server' }));
        return;
      }

      // Readiness is the single deployment gate. A configured database must
      // be connected and migrated through the current schema before traffic
      // is admitted; local development without a database remains ready.
      if (req.method === 'GET' && healthPath === '/readyz') {
        let databaseReady = true;
        if (persistenceManager) {
          try {
            await ensureInit();
            databaseReady = await persistenceManager.isHealthy();
          } catch {
            databaseReady = false;
          }
        }
        const statusCode = databaseReady ? 200 : 503;
        res.writeHead(statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({
          status: databaseReady ? 'ready' : 'not_ready',
          service: 'game-server',
          database: databaseReady ? 'ready' : 'unavailable'
        }));
        return;
      }

      if (urlStr.startsWith('/api/') || urlStr === '/api') {
        try {
          await ensureInit();
        } catch (initErr) {
          if (!res.headersSent) {
            res.writeHead(503, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            });
            res.end(
              JSON.stringify({
                error: {
                  code: 'DATABASE_UNAVAILABLE',
                  message: 'Database service is currently unavailable'
                }
              })
            );
          }
          return;
        }
        await apiHandler(req, res);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(
          JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Internal server error'
            }
          })
        );
      }
    }
  });

  // Define room
  gameServer.define('classic_26', Classic26Room, {
    persistence: persistenceManager,
    outbox: outboxManager
  });

  gameServer.define('duel_26', DuelRoom, {
    persistence: persistenceManager,
    outbox: outboxManager,
    allowedOrigins
  });

  gameServer.define('auction_26', AuctionRoom, {
    persistence: persistenceManager,
    outbox: outboxManager,
    allowedOrigins
  });

  gameServer.define('challenge_26', Challenge26Room, {
    persistence: persistenceManager,
    outbox: outboxManager
  });

  gameServer.define('survivor_26', SurvivorRoom, {
    persistence: persistenceManager,
    outbox: outboxManager
  });

  gameServer.define('tournament_26', TournamentRoom, {
    persistence: persistenceManager,
    outbox: outboxManager,
    allowedOrigins
  });

  return {
    httpServer,
    gameServer,
    persistence: persistenceManager,
    outbox: outboxManager,
    ensureInit,
    listen: async (port = options.port || 2567, host = options.host || '0.0.0.0'): Promise<number> => {
      await ensureInit();
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const addr = httpServer.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(actualPort);
        });
      });
    },
    close: async (): Promise<void> => {
      // 1. Dispose rooms first (allows active rooms to settle and enqueue final records)
      try {
        await gameServer.gracefullyShutdown(false);
      } catch (err) {
        console.error('[server] Error during gameServer shutdown:', err);
      }

      // 2. Drain and close outbox with bounded timeout (retains files on disk if db fails)
      if (outboxManager) {
        try {
          await outboxManager.drain(3000);
        } catch {
          console.warn('[server] Outbox drain timed out during shutdown (retaining files on disk)');
        }
        await outboxManager.close();
      }

      // 3. Close database connection pool
      if (persistenceManager) {
        await persistenceManager.close();
      }

      // 4. Close HTTP server
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  };
}
