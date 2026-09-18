import http from 'node:http';
import crypto from 'node:crypto';
import { matchMaker } from '@colyseus/core';
import { DatabaseManager } from '../persistence/db';
import { parseCookies, serializeGuestCookie } from './cookies';
import {
  isValidId,
  parsePagination,
  readJsonBody,
  getClientIp,
  hashRiskFingerprint,
  verifyAdminHeaderToken,
  generateAdminSessionCookie,
  verifyAdminSessionCookie,
  isRequestOriginAllowed
} from './security';
import type { RankingBoard } from '../../../../packages/protocol/src/ranking';

const VALID_RANKING_BOARDS = new Set<RankingBoard>([
  'elo',
  'net_profit',
  'challenger_profit',
  'banker_profit',
  'win_rate',
  'survivor_wins',
  'tournament_wins',
  'matches',
  'single_highest',
  'single_margin'
]);

export interface RouterOptions {
  db?: DatabaseManager;
  allowedOrigins: Set<string>;
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {}
): void {
  sendJson(res, statusCode, { error: { code, message } }, extraHeaders);
}

export function createHttpHandler(options: RouterOptions) {
  const { db, allowedOrigins } = options;

  return async function handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const urlStr = req.url || '/';
    if (!urlStr.startsWith('/api/') && urlStr !== '/api') {
      return false; // Not handled by this router
    }

    const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers.host || '127.0.0.1';
    const parsedUrl = new URL(urlStr, `http://${hostHeader}`);
    const pathname = parsedUrl.pathname;
    const origin = req.headers.origin;
    const originAllowed = isRequestOriginAllowed(origin, req, allowedOrigins);

    const corsHeaders: Record<string, string> = {};
    if (origin && originAllowed) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Credentials'] = 'true';
      corsHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        ...corsHeaders
      });
      res.end();
      return true;
    }

    // Origin check: mutating POST and PATCH requests strictly require allowed origin if sent, and required for guest endpoints
    if (req.method === 'POST' || req.method === 'PATCH') {
      if (!originAllowed && !pathname.startsWith('/api/admin')) {
        sendError(res, 403, 'INVALID_ORIGIN', 'Origin is required and must be allowed', corsHeaders);
        return true;
      }
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps = forwardedProto === 'https' || (req.socket as any)?.encrypted === true || (origin ? origin.startsWith('https:') : false);
    const isSecure = isHttps || (process.env.NODE_ENV === 'production' && forwardedProto !== 'http' && (!origin || !origin.startsWith('http:')));

    // Helper: authenticate guest from cookie
    const getAuthenticatedGuest = async (): Promise<{
      guest: { id: string; token_hash: string } | null;
      rawToken: string | null;
      dbDown: boolean;
    }> => {
      if (!db) return { guest: null, rawToken: null, dbDown: false };
      const healthy = await db.isHealthy();
      if (!healthy) return { guest: null, rawToken: null, dbDown: true };

      const cookies = parseCookies(req.headers.cookie);
      const rawToken = cookies['bf_guest'];
      if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
        return { guest: null, rawToken: null, dbDown: false };
      }

      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      try {
        const guest = await db.getGuestByTokenHash(tokenHash);
        if (guest) {
          await db.touchGuest(guest.id);
        }
        return { guest, rawToken, dbDown: false };
      } catch {
        return { guest: null, rawToken: null, dbDown: true };
      }
    };

    // 0.5. GET /api/achievements
    // Achievements are derived from authoritative settlement events and are
    // readable only by the guest that owns the browser credential.
    if (req.method === 'GET' && pathname === '/api/achievements') {
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest achievements are disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Guest identity is required', corsHeaders);
        return true;
      }
      try {
        const items = await db.getAchievementsForGuest(guest.id);
        sendJson(res, 200, { items }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Guest achievements are temporarily unavailable', corsHeaders);
      }
      return true;
    }

    // 1. GET /api/guest
    if (req.method === 'GET' && pathname === '/api/guest') {
      if (!db) {
        sendJson(res, 200, { enabled: false, available: false, authenticated: false }, corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }

      sendJson(
        res,
        200,
        { enabled: true, available: true, authenticated: Boolean(guest) },
        corsHeaders
      );
      return true;
    }

    // 2. POST /api/guest
    if (req.method === 'POST' && pathname === '/api/guest') {
      // Enforce 16KiB limit and valid JSON on POST /api/guest
      const bodyRes = await readJsonBody(req);
      if (!bodyRes.ok) {
        sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, rawToken, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }

      if (guest && rawToken) {
        // Renew persistent cookie for another year, preserve identity, never expose rawToken in body
        const renewedCookie = serializeGuestCookie(rawToken, isSecure);
        sendJson(
          res,
          200,
          { enabled: true, available: true, authenticated: true },
          { ...corsHeaders, 'Set-Cookie': renewedCookie }
        );
        return true;
      }

      // Generate new guest
      try {
        const newRawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
        await db.createGuest(tokenHash);

        const cookieHeader = serializeGuestCookie(newRawToken, isSecure);
        sendJson(
          res,
          200,
          { enabled: true, available: true, authenticated: true },
          { ...corsHeaders, 'Set-Cookie': cookieHeader }
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 3. GET /api/history
    if (req.method === 'GET' && pathname === '/api/history') {
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_QUERY', pagination.error, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const result = await db.getHistoryByOwner(
          guest.id,
          pagination.limit,
          pagination.offset
        );
        sendJson(
          res,
          200,
          {
            items: result.items,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 4. POST /api/history/:resultId/share
    const shareMatch = pathname.match(/^\/api\/history\/([^/]+)\/share$/);
    if (req.method === 'POST' && shareMatch) {
      const resultId = shareMatch[1];
      if (!isValidId(resultId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid result ID format', corsHeaders);
        return true;
      }

      const bodyRes = await readJsonBody(req);
      if (!bodyRes.ok) {
        sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const shareResult = await db.createOrGetShare(resultId, guest.id);
        if (!shareResult) {
          sendError(res, 404, 'NOT_FOUND', 'Game record not found', corsHeaders);
          return true;
        }

        sendJson(
          res,
          200,
          {
            shareId: shareResult.shareId,
            path: `/share/${shareResult.shareId}`
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 5. GET /api/history/:resultId
    const historyDetailMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === 'GET' && historyDetailMatch) {
      const resultId = historyDetailMatch[1];
      if (!isValidId(resultId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid result ID format', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const record = await db.getCompletedGame(resultId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Game record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, record, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    const classicReplayMatch = pathname.match(/^\/api\/history\/([^/]+)\/replay$/);
    if (req.method === 'GET' && classicReplayMatch) {
      const resultId = classicReplayMatch[1];
      if (!isValidId(resultId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid result ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedGame(resultId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Game replay not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, {
          resultId,
          gameId: record.gameId,
          ruleVersion: record.ruleVersion,
          completedAt: record.completedAt,
          events: record.auditTrail || []
        }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 6. GET /api/share/:shareId
    const publicShareMatch = pathname.match(/^\/api\/share\/([^/]+)$/);
    if (req.method === 'GET' && publicShareMatch) {
      const shareId = publicShareMatch[1];
      if (!isValidId(shareId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid share ID format', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }

      try {
        const summary = await db.getPublicShare(shareId);
        if (!summary) {
          sendError(res, 404, 'NOT_FOUND', 'Shared record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, summary, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 7. GET /api/duel/history
    if (req.method === 'GET' && pathname === '/api/duel/history') {
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const result = await db.getDuelHistoryByGuest(
          guest.id,
          pagination.limit,
          pagination.offset
        );
        sendJson(
          res,
          200,
          {
            items: result.items,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 8. GET /api/duel/history/:matchId/replay
    const duelReplayMatch = pathname.match(/^\/api\/duel\/history\/([^/]+)\/replay$/);
    if (req.method === 'GET' && duelReplayMatch) {
      const matchId = duelReplayMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedDuel(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Duel replay not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, { resultId: record.resultId, matchId: record.matchId, ruleVersion: record.ruleVersion, completedAt: record.completedAt, events: record.result.auditTrail || [] }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 8b. GET /api/duel/history/:matchId
    const duelHistoryDetailMatch = pathname.match(/^\/api\/duel\/history\/([^/]+)$/);
    if (req.method === 'GET' && duelHistoryDetailMatch) {
      const matchId = duelHistoryDetailMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const record = await db.getCompletedDuel(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Duel record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, record, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 9. GET /api/auction/rooms (safe public lobby summaries only)
    if (req.method === 'GET' && pathname === '/api/auction/rooms') {
      try {
        const rooms = await matchMaker.query({
          name: 'auction_26',
          private: false,
          unlisted: false
        });
        const items = rooms.map((room: any) => ({
          roomId: room.roomId,
          players: Number(room.clients || 0),
          maxPlayers: 8,
          allowSpectators: room.metadata?.allowSpectators !== false,
          allowEmotes: room.metadata?.allowEmotes !== false,
          showBidHistory: room.metadata?.showBidHistory !== false,
          ranked: room.metadata?.ranked !== false,
          themeId: room.metadata?.themeId === 'starry-neon' ? 'starry-neon' : 'classic',
          ruleVersion: 'auction-26-v1'
        }));
        sendJson(res, 200, { items }, corsHeaders);
      } catch {
        sendJson(res, 200, { items: [] }, corsHeaders);
      }
      return true;
    }

    // 9b. GET /api/tournament/rooms (safe public lobby summaries only)
    if (req.method === 'GET' && pathname === '/api/tournament/rooms') {
      try {
        const rooms = await matchMaker.query({
          name: 'tournament_26',
          private: false,
          unlisted: false
        });
        const items = rooms.map((room: any) => ({
          roomId: room.roomId,
          players: Number(room.clients || 0),
          maxPlayers: Number(room.metadata?.size || 8),
          allowSpectators: room.metadata?.allowSpectators !== false,
          allowEmotes: room.metadata?.allowEmotes !== false,
          themeId: room.metadata?.themeId === 'starry-neon' ? 'starry-neon' : 'classic',
          ruleVersion: 'tournament-26-v1'
        }));
        sendJson(res, 200, { items }, corsHeaders);
      } catch {
        sendJson(res, 200, { items: [] }, corsHeaders);
      }
      return true;
    }

    // 9c. GET /api/survivor/rooms (safe public lobby summaries only)
    if (req.method === 'GET' && pathname === '/api/survivor/rooms') {
      try {
        const rooms = await matchMaker.query({ name: 'survivor_26', private: false, unlisted: false });
        const items = rooms.map((room: any) => ({
          roomId: room.roomId,
          players: Number(room.clients || 0),
          maxPlayers: Number(room.metadata?.maxPlayers || 6),
          allowSpectators: room.metadata?.allowSpectators !== false,
          themeId: room.metadata?.themeId === 'starry-neon' ? 'starry-neon' : 'classic',
          ruleVersion: 'survivor-26-v1'
        }));
        sendJson(res, 200, { items }, corsHeaders);
      } catch {
        sendJson(res, 200, { items: [] }, corsHeaders);
      }
      return true;
    }

    // 9d. GET /api/duel/rooms (safe public lobby summaries only)
    if (req.method === 'GET' && pathname === '/api/duel/rooms') {
      try {
        const rooms = await matchMaker.query({ name: 'duel_26', private: false, unlisted: false });
        const items = rooms.map((room: any) => ({
          roomId: room.roomId,
          players: Number(room.clients || 0),
          maxPlayers: 2,
          ranked: room.metadata?.ranked !== false,
          passwordRequired: room.metadata?.passwordRequired === true,
          showOfferHistory: room.metadata?.showOfferHistory !== false,
          themeId: room.metadata?.themeId === 'starry-neon' ? 'starry-neon' : 'classic',
          ruleVersion: 'duel-26-v1'
        }));
        sendJson(res, 200, { items }, corsHeaders);
      } catch {
        sendJson(res, 200, { items: [] }, corsHeaders);
      }
      return true;
    }

    // 10. GET /api/auction/history
    if (req.method === 'GET' && pathname === '/api/auction/history') {
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const result = await db.getAuctionHistoryByGuest(
          guest.id,
          pagination.limit,
          pagination.offset
        );
        sendJson(
          res,
          200,
          {
            items: result.items,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 10. GET /api/auction/history/:matchId/replay
    const auctionReplayMatch = pathname.match(/^\/api\/auction\/history\/([^/]+)\/replay$/);
    if (req.method === 'GET' && auctionReplayMatch) {
      const matchId = auctionReplayMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedAuction(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Auction replay not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, { resultId: record.resultId, matchId: record.matchId, ruleVersion: record.ruleVersion, completedAt: record.completedAt, events: record.result.auditTrail || [] }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 10b. GET /api/auction/history/:matchId
    const auctionHistoryDetailMatch = pathname.match(/^\/api\/auction\/history\/([^/]+)$/);
    if (req.method === 'GET' && auctionHistoryDetailMatch) {
      const matchId = auctionHistoryDetailMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const record = await db.getCompletedAuction(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Auction record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, record, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 11. POST /api/auction/history/:resultId/share (and /api/auction/:resultId/share)
    const auctionShareMatch = pathname.match(/^\/api\/auction\/(?:history\/)?([^/]+)\/share$/);
    if (req.method === 'POST' && auctionShareMatch) {
      const resultId = auctionShareMatch[1];
      if (!isValidId(resultId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid result ID format', corsHeaders);
        return true;
      }

      const bodyRes = await readJsonBody(req);
      if (!bodyRes.ok) {
        sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      try {
        const shareResult = await db.createOrGetAuctionShare(resultId, guest.id);
        if (!shareResult) {
          sendError(res, 404, 'NOT_FOUND', 'Auction record not found', corsHeaders);
          return true;
        }

        sendJson(
          res,
          200,
          {
            shareId: shareResult.shareId,
            path: `/share/auction/${shareResult.shareId}`
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 12. GET /api/share/auction/:shareId
    const publicAuctionShareMatch = pathname.match(/^\/api\/share\/auction\/([^/]+)$/);
    if (req.method === 'GET' && publicAuctionShareMatch) {
      const shareId = publicAuctionShareMatch[1];
      if (!isValidId(shareId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid share ID format', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }

      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }

      try {
        const summary = await db.getPublicAuctionShare(shareId);
        if (!summary) {
          sendError(res, 404, 'NOT_FOUND', 'Shared record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, summary, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 12b. POST /api/{duel|survivor|tournament}/history/:id/share
    const multiplayerShareMatch = pathname.match(/^\/api\/(duel|survivor|tournament)\/history\/([^/]+)\/share$/);
    if (req.method === 'POST' && multiplayerShareMatch) {
      const mode = multiplayerShareMatch[1] as 'duel' | 'survivor' | 'tournament';
      const resultOrMatchId = multiplayerShareMatch[2];
      if (!isValidId(resultOrMatchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid result ID format', corsHeaders);
        return true;
      }
      const bodyRes = await readJsonBody(req);
      if (!bodyRes.ok) {
        sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const shareResult = await db.createOrGetMultiplayerShare(mode, resultOrMatchId, guest.id);
        if (!shareResult) {
          sendError(res, 404, 'NOT_FOUND', 'Multiplayer record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, { shareId: shareResult.shareId, path: `/share/${mode}/${shareResult.shareId}` }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 12c. GET /api/share/{duel|survivor|tournament}/:shareId
    const publicMultiplayerShareMatch = pathname.match(/^\/api\/share\/(duel|survivor|tournament)\/([^/]+)$/);
    if (req.method === 'GET' && publicMultiplayerShareMatch) {
      const mode = publicMultiplayerShareMatch[1] as 'duel' | 'survivor' | 'tournament';
      const shareId = publicMultiplayerShareMatch[2];
      if (!isValidId(shareId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid share ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      if (!await db.isHealthy()) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      try {
        const summary = await db.getPublicMultiplayerShare(mode, shareId);
        if (!summary) {
          sendError(res, 404, 'NOT_FOUND', 'Shared record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, summary, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 13. GET /api/survivor/history and /api/survivor/history/:matchId
    if (req.method === 'GET' && pathname === '/api/survivor/history') {
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }
      try {
        const result = await db.getSurvivorHistoryByGuest(guest.id, pagination.limit, pagination.offset);
        sendJson(res, 200, { ...result, limit: pagination.limit, offset: pagination.offset }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    const survivorReplayMatch = pathname.match(/^\/api\/survivor\/history\/([^/]+)\/replay$/);
    if (req.method === 'GET' && survivorReplayMatch) {
      const matchId = survivorReplayMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedSurvivor(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Survivor replay not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, { resultId: record.resultId, matchId: record.matchId, ruleVersion: record.ruleVersion, completedAt: record.completedAt, events: record.result.auditTrail || [] }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    const survivorHistoryDetailMatch = pathname.match(/^\/api\/survivor\/history\/([^/]+)$/);
    if (req.method === 'GET' && survivorHistoryDetailMatch) {
      const matchId = survivorHistoryDetailMatch[1];
      if (!isValidId(matchId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid match ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedSurvivor(matchId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Survivor match not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, record, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 13b. GET /api/tournament/history and /api/tournament/history/:tournamentId
    if (req.method === 'GET' && pathname === '/api/tournament/history') {
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }
      try {
        const result = await db.getTournamentHistoryByGuest(guest.id, pagination.limit, pagination.offset);
        sendJson(res, 200, { ...result, limit: pagination.limit, offset: pagination.offset }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    const tournamentHistoryDetailMatch = pathname.match(/^\/api\/tournament\/history\/([^/]+)$/);
    const tournamentReplayMatch = pathname.match(/^\/api\/tournament\/history\/([^/]+)\/replay$/);
    if (req.method === 'GET' && tournamentReplayMatch) {
      const tournamentId = tournamentReplayMatch[1];
      if (!isValidId(tournamentId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid tournament ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedTournament(tournamentId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Tournament replay not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, {
          tournamentId: record.tournamentId,
          resultId: record.resultId,
          ruleVersion: record.ruleVersion,
          completedAt: record.completedAt,
          rankings: record.result.rankings,
          matches: record.result.matches,
          events: record.result.auditTrail
        }, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }
    if (req.method === 'GET' && tournamentHistoryDetailMatch) {
      const tournamentId = tournamentHistoryDetailMatch[1];
      if (!isValidId(tournamentId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid tournament ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'HISTORY_DISABLED', 'Guest history is disabled', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const record = await db.getCompletedTournament(tournamentId, guest.id);
        if (!record) {
          sendError(res, 404, 'NOT_FOUND', 'Tournament record not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, record, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // Helper: authenticate admin
    const isAdminAuthenticated = (): boolean => {
      const adminHeader = req.headers['x-admin-token'];
      if (typeof adminHeader === 'string' && verifyAdminHeaderToken(adminHeader)) {
        return true;
      }
      return verifyAdminSessionCookie(req.headers.cookie);
    };

    // 13. GET /api/themes (safe public runtime theme manifest)
    if (req.method === 'GET' && pathname === '/api/themes') {
      const fallback = { activeTheme: 'classic', availableThemes: ['classic', 'starry-neon'] };
      if (!db) {
        sendJson(res, 200, fallback, corsHeaders);
        return true;
      }
      try {
        const healthy = await db.isHealthy();
        if (!healthy) {
          sendJson(res, 200, fallback, corsHeaders);
          return true;
        }
        const config = await db.getRuntimeConfig('themes');
        const value = config?.value as any;
        const availableThemes = Array.isArray(value?.availableThemes)
          ? value.availableThemes.filter((id: unknown) => id === 'classic' || id === 'starry-neon')
          : fallback.availableThemes;
        const activeTheme = availableThemes.includes(value?.activeTheme) ? value.activeTheme : 'classic';
        sendJson(res, 200, { activeTheme, availableThemes }, corsHeaders);
      } catch {
        sendJson(res, 200, fallback, corsHeaders);
      }
      return true;
    }

    // 14. GET /api/seasons
    if (req.method === 'GET' && pathname === '/api/seasons') {
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      try {
        const seasons = await db.getSeasons();
        const activeSeason = await db.getActiveSeason();
        sendJson(
          res,
          200,
          {
            items: seasons,
            activeSeasonId: activeSeason ? activeSeason.seasonId : null
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 14. GET /api/seasons/:seasonId
    const seasonDetailMatch = pathname.match(/^\/api\/seasons\/([^/]+)$/);
    if (req.method === 'GET' && seasonDetailMatch) {
      const seasonId = seasonDetailMatch[1];
      if (!isValidId(seasonId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid season ID format', corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      try {
        const season = await db.getSeasonById(seasonId);
        if (!season) {
          sendError(res, 404, 'NOT_FOUND', 'Season not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, season, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 15. GET /api/rankings
    if (req.method === 'GET' && pathname === '/api/rankings') {
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      try {
        const requestedSeasonId = parsedUrl.searchParams.get('seasonId') || undefined;
        const requestedBoard = parsedUrl.searchParams.get('board') || 'elo';
        if (!VALID_RANKING_BOARDS.has(requestedBoard as RankingBoard)) {
          sendError(res, 400, 'INVALID_BOARD', 'Invalid ranking board', corsHeaders);
          return true;
        }
        const activeSeason = requestedSeasonId
          ? await db.getSeasonById(requestedSeasonId)
          : await db.getActiveSeason();
        if (!activeSeason) {
          if (requestedSeasonId) {
            sendError(res, 404, 'NOT_FOUND', 'Season not found', corsHeaders);
            return true;
          }
          sendJson(
            res,
            200,
            {
              seasonId: '',
              board: requestedBoard,
              items: [],
              total: 0,
              limit: pagination.limit,
              offset: pagination.offset
            },
            corsHeaders
          );
          return true;
        }
        const result = await db.getRankings(activeSeason.seasonId, pagination.limit, pagination.offset, requestedBoard as RankingBoard);
        sendJson(
          res,
          200,
          {
            seasonId: activeSeason.seasonId,
            board: requestedBoard,
            items: result.items,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 16. GET /api/rankings/:seasonId
    const rankingSeasonMatch = pathname.match(/^\/api\/rankings\/([^/]+)$/);
    if (req.method === 'GET' && rankingSeasonMatch) {
      const seasonId = rankingSeasonMatch[1];
      if (!isValidId(seasonId)) {
        sendError(res, 400, 'INVALID_ID', 'Invalid season ID format', corsHeaders);
        return true;
      }
      const pagination = parsePagination(parsedUrl);
      if (!pagination.valid) {
        sendError(res, 400, 'INVALID_PAGINATION', pagination.error, corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      try {
        const season = await db.getSeasonById(seasonId);
        if (!season) {
          sendError(res, 404, 'NOT_FOUND', 'Season not found', corsHeaders);
          return true;
        }
        const requestedBoard = parsedUrl.searchParams.get('board') || 'elo';
        if (!VALID_RANKING_BOARDS.has(requestedBoard as RankingBoard)) {
          sendError(res, 400, 'INVALID_BOARD', 'Invalid ranking board', corsHeaders);
          return true;
        }
        const result = await db.getRankings(seasonId, pagination.limit, pagination.offset, requestedBoard as RankingBoard);
        sendJson(
          res,
          200,
          {
            seasonId,
            board: requestedBoard,
            items: result.items,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 17. GET /api/profile/summary
    if (req.method === 'GET' && pathname === '/api/profile/summary') {
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }
      try {
        const seasonParam = parsedUrl.searchParams.get('seasonId') || undefined;
        const summary = await db.getProfileSummary(guest.id, seasonParam);
        if (!summary) {
          sendError(res, 404, 'NOT_FOUND', 'Profile not found', corsHeaders);
          return true;
        }
        sendJson(res, 200, summary, corsHeaders);
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 18. POST /api/reports
    if (req.method === 'POST' && pathname === '/api/reports') {
      const bodyRes = await readJsonBody(req);
      if (!bodyRes.ok) {
        sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
        return true;
      }
      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const { guest, dbDown } = await getAuthenticatedGuest();
      if (dbDown) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      if (!guest) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', corsHeaders);
        return true;
      }

      const { targetType, targetId, category, reason } = bodyRes.data || {};
      if (
        typeof targetType !== 'string' || !targetType.trim() ||
        typeof targetId !== 'string' || !targetId.trim() ||
        typeof category !== 'string' || !category.trim()
      ) {
        sendError(res, 400, 'INVALID_PAYLOAD', 'targetType, targetId, and category are required', corsHeaders);
        return true;
      }
      const allowedReportCategories = new Set(['cheating', 'harassment', 'exploit', 'collusion', 'match_fixing', 'stall', 'other']);
      if (!allowedReportCategories.has(category.trim()) || targetId.trim().length > 128 || (typeof reason === 'string' && reason.trim().length > 200)) {
        sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid report category or field length', corsHeaders);
        return true;
      }

      const clientIp = getClientIp(req);
      const ipFingerprint = hashRiskFingerprint(clientIp);

      try {
        const result = await db.createReport({
          reporterGuestId: guest.id,
          targetType: targetType.trim(),
          targetId: targetId.trim(),
          category: category.trim(),
          reason: typeof reason === 'string' ? reason.trim() : '',
          ipFingerprint
        });

        if (result.conflict) {
          sendError(res, 409, 'REPORT_CONFLICT', 'A report for this target and category has already been submitted', corsHeaders);
          return true;
        }

        if (result.rateLimited) {
          sendError(res, 429, 'REPORT_RATE_LIMITED', 'Too many reports submitted. Please try again later.', corsHeaders);
          return true;
        }

        sendJson(
          res,
          201,
          {
            success: true,
            reportId: result.reportId,
            status: 'pending'
          },
          corsHeaders
        );
      } catch {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
      }
      return true;
    }

    // 19. POST /api/admin/session
    if (req.method === 'POST' && pathname === '/api/admin/session') {
      const envToken = process.env.BF_ADMIN_TOKEN;
      if (!envToken) {
        sendError(res, 503, 'ADMIN_DISABLED', 'Admin session is disabled', corsHeaders);
        return true;
      }

      const headerToken = req.headers['x-admin-token'];
      if (!headerToken || typeof headerToken !== 'string' || !verifyAdminHeaderToken(headerToken)) {
        sendError(res, 401, 'UNAUTHORIZED', 'Invalid admin token', corsHeaders);
        return true;
      }

      const { cookieHeader } = generateAdminSessionCookie(isSecure);
      const clientIp = getClientIp(req);
      const ipFingerprint = hashRiskFingerprint(clientIp);

      if (db) {
        await db.writeAdminAuditLog({
          adminId: 'admin',
          action: 'ADMIN_LOGIN',
          targetType: 'session',
          targetId: 'admin_session',
          details: { userAgent: req.headers['user-agent'] },
          ipFingerprint
        });
      }

      sendJson(
        res,
        200,
        { success: true, authenticated: true },
        { ...corsHeaders, 'Set-Cookie': cookieHeader }
      );
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      sendJson(res, 200, { success: true }, { ...corsHeaders, 'Set-Cookie': `bf_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}` });
      return true;
    }

    // Admin Auth Guard for all other /api/admin/* endpoints
    if (pathname.startsWith('/api/admin/') || pathname === '/api/admin') {
      if (!isAdminAuthenticated()) {
        sendError(res, 401, 'UNAUTHORIZED', 'Admin authentication required', corsHeaders);
        return true;
      }

      if (!db) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }
      const healthy = await db.isHealthy();
      if (!healthy) {
        sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        return true;
      }

      const clientIp = getClientIp(req);
      const ipFingerprint = hashRiskFingerprint(clientIp);

      // 20. /api/admin/seasons
      if (pathname === '/api/admin/seasons') {
        if (req.method === 'GET') {
          try {
            const seasons = await db.getSeasons();
            sendJson(res, 200, { items: seasons }, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }

        if (req.method === 'POST') {
          const bodyRes = await readJsonBody(req);
          if (!bodyRes.ok) {
            sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
            return true;
          }
          const { id, name, ruleVersion, startAt, endAt, status } = bodyRes.data || {};
          const seasonStatuses = new Set(['upcoming', 'active', 'completed', 'archived']);
          if (!isValidId(id) || typeof name !== 'string' || name.trim().length === 0 || name.length > 120 || typeof ruleVersion !== 'string' || !/^[-a-zA-Z0-9._]+$/.test(ruleVersion) || !Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt || (status !== undefined && !seasonStatuses.has(status))) {
            sendError(res, 400, 'INVALID_PAYLOAD', 'id, name, startAt, and endAt are required', corsHeaders);
            return true;
          }
          try {
            const season = await db.createSeason({ id, name, ruleVersion, startAt, endAt, status });
            await db.writeAdminAuditLog({
              adminId: 'admin',
              action: 'CREATE_SEASON',
              targetType: 'season',
              targetId: season.seasonId,
              details: bodyRes.data,
              ipFingerprint
            });
            sendJson(res, 201, season, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }
      }

      const adminSeasonPatchMatch = pathname.match(/^\/api\/admin\/seasons\/([^/]+)$/);
      if (req.method === 'PATCH' && adminSeasonPatchMatch) {
        const seasonId = adminSeasonPatchMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
          return true;
        }
        const patch = bodyRes.data || {};
        const seasonStatuses = new Set(['upcoming', 'active', 'completed', 'archived']);
        if ((patch.name !== undefined && (typeof patch.name !== 'string' || patch.name.trim().length === 0 || patch.name.length > 120)) || (patch.status !== undefined && !seasonStatuses.has(patch.status)) || (patch.startAt !== undefined && !Number.isSafeInteger(patch.startAt)) || (patch.endAt !== undefined && !Number.isSafeInteger(patch.endAt))) {
          sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid season update', corsHeaders);
          return true;
        }
        try {
          const updated = await db.updateSeason(seasonId, bodyRes.data || {});
          if (!updated) {
            sendError(res, 404, 'NOT_FOUND', 'Season not found', corsHeaders);
            return true;
          }
          await db.writeAdminAuditLog({
            adminId: 'admin',
            action: 'UPDATE_SEASON',
            targetType: 'season',
            targetId: seasonId,
            details: bodyRes.data,
            ipFingerprint
          });
          sendJson(res, 200, updated, corsHeaders);
        } catch (err: any) {
          if (err instanceof Error && err.message === 'Invalid season configuration') {
            sendError(res, 400, 'INVALID_PAYLOAD', err.message, corsHeaders);
          } else {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
        }
        return true;
      }

      // 21. /api/admin/config
      if (pathname === '/api/admin/config') {
        if (req.method === 'GET') {
          try {
            const configs = await db.getAllRuntimeConfigs();
            sendJson(res, 200, { items: configs }, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }

        if (req.method === 'POST') {
          const bodyRes = await readJsonBody(req);
          if (!bodyRes.ok) {
            sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
            return true;
          }
          const { key, value, description } = bodyRes.data || {};
          if (!key || typeof key !== 'string') {
            sendError(res, 400, 'INVALID_PAYLOAD', 'key is required', corsHeaders);
            return true;
          }
          try {
            const config = await db.setRuntimeConfig(key, value, description, 'admin');
            await db.writeAdminAuditLog({
              adminId: 'admin',
              action: 'UPDATE_CONFIG',
              targetType: 'runtime_config',
              targetId: key,
              details: { value, description },
              ipFingerprint
            });
            sendJson(res, 200, config, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }
      }

      const adminConfigPatchMatch = pathname.match(/^\/api\/admin\/config\/([^/]+)$/);
      if (req.method === 'PATCH' && adminConfigPatchMatch) {
        const key = adminConfigPatchMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
          return true;
        }
        const { value, description } = bodyRes.data || {};
        try {
          const config = await db.setRuntimeConfig(key, value, description, 'admin');
          await db.writeAdminAuditLog({
            adminId: 'admin',
            action: 'UPDATE_CONFIG',
            targetType: 'runtime_config',
            targetId: key,
            details: { value, description },
            ipFingerprint
          });
          sendJson(res, 200, config, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        }
        return true;
      }

      // 22. /api/admin/themes
      if (pathname === '/api/admin/themes') {
        if (req.method === 'GET') {
          try {
            const config = await db.getRuntimeConfig('themes');
            sendJson(res, 200, config?.value || { activeTheme: 'classic', availableThemes: ['classic', 'starry-neon'] }, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }

        if (req.method === 'POST') {
          const bodyRes = await readJsonBody(req);
          if (!bodyRes.ok) {
            sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
            return true;
          }
          try {
            const updated = await db.setRuntimeConfig('themes', bodyRes.data, 'Theme configuration', 'admin');
            await db.writeAdminAuditLog({
              adminId: 'admin',
              action: 'UPDATE_THEMES',
              targetType: 'themes',
              targetId: 'themes',
              details: bodyRes.data,
              ipFingerprint
            });
            sendJson(res, 200, updated.value, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }
      }

      const adminThemePatchMatch = pathname.match(/^\/api\/admin\/themes\/([^/]+)$/);
      if (req.method === 'PATCH' && adminThemePatchMatch) {
        const themeId = adminThemePatchMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
          return true;
        }
        try {
          const currentConfig = await db.getRuntimeConfig('themes');
          const currentVal = currentConfig?.value || { activeTheme: 'classic', availableThemes: ['classic'] };
          const { enabled, setActive } = bodyRes.data || {};
          if (setActive && themeId) {
            currentVal.activeTheme = themeId;
          }
          if (enabled === true && !currentVal.availableThemes?.includes(themeId)) {
            currentVal.availableThemes = [...(currentVal.availableThemes || []), themeId];
          } else if (enabled === false && currentVal.availableThemes?.includes(themeId)) {
            currentVal.availableThemes = currentVal.availableThemes.filter((t: string) => t !== themeId);
          }
          const updated = await db.setRuntimeConfig('themes', currentVal, 'Theme configuration', 'admin');
          await db.writeAdminAuditLog({
            adminId: 'admin',
            action: 'UPDATE_THEME',
            targetType: 'theme',
            targetId: themeId,
            details: bodyRes.data,
            ipFingerprint
          });
          sendJson(res, 200, updated.value, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        }
        return true;
      }

      // 23. /api/admin/reports
      if (pathname === '/api/admin/reports') {
        if (req.method === 'GET') {
          const pagination = parsePagination(parsedUrl);
          const status = parsedUrl.searchParams.get('status') || undefined;
          try {
            const reports = await db.getReports({
              status,
              limit: pagination.valid ? pagination.limit : 20,
              offset: pagination.valid ? pagination.offset : 0
            });
            sendJson(res, 200, reports, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }
      }

      const adminReportPatchMatch = pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if (req.method === 'PATCH' && adminReportPatchMatch) {
        const reportId = adminReportPatchMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
          return true;
        }
        const { status, notes } = bodyRes.data || {};
        if (!status || !['pending', 'reviewed', 'actioned', 'dismissed'].includes(status)) {
          sendError(res, 400, 'INVALID_PAYLOAD', 'status is required', corsHeaders);
          return true;
        }
        try {
          const ok = await db.updateReportStatus(reportId, status, notes);
          if (!ok) {
            sendError(res, 404, 'NOT_FOUND', 'Report not found', corsHeaders);
            return true;
          }
          await db.writeAdminAuditLog({
            adminId: 'admin',
            action: 'UPDATE_REPORT',
            targetType: 'report',
            targetId: reportId,
            details: bodyRes.data,
            ipFingerprint
          });
          sendJson(res, 200, { success: true, reportId, status }, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        }
        return true;
      }

      // 24. /api/admin/bans
      if (pathname === '/api/admin/bans') {
        if (req.method === 'GET') {
          try {
            const bans = await db.getActiveBans();
            sendJson(res, 200, { items: bans }, corsHeaders);
          } catch {
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }

        if (req.method === 'POST') {
          const bodyRes = await readJsonBody(req);
          if (!bodyRes.ok) {
            sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
            return true;
          }
          const { guestId, reason, severity, excludeRanking } = bodyRes.data || {};
          if (!guestId || typeof guestId !== 'string') {
            sendError(res, 400, 'INVALID_PAYLOAD', 'guestId is required', corsHeaders);
            return true;
          }
          try {
            const banId = await db.createRiskFlag({
              guestId,
              flagType: 'BANNED',
              severity: severity || 'critical',
              reason: reason || 'Admin ban',
              excludeRanking: excludeRanking ?? true,
              ipFingerprint
            });
            await db.writeAdminAuditLog({
              adminId: 'admin',
              action: 'BAN_GUEST',
              targetType: 'guest',
              targetId: guestId,
              details: bodyRes.data,
              ipFingerprint
            });
            sendJson(res, 201, { success: true, banId, guestId }, corsHeaders);
          } catch (err: any) {
            if (err && err.code === '23503') {
              sendError(res, 404, 'GUEST_NOT_FOUND', 'Target guest does not exist', corsHeaders);
              return true;
            }
            sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
          }
          return true;
        }
      }

      const adminBanPatchMatch = pathname.match(/^\/api\/admin\/bans\/([^/]+)$/);
      if (req.method === 'PATCH' && adminBanPatchMatch) {
        const banId = adminBanPatchMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendError(res, bodyRes.status, bodyRes.code, bodyRes.message, corsHeaders);
          return true;
        }
        const { isActive } = bodyRes.data || {};
        if (typeof isActive !== 'boolean') {
          sendError(res, 400, 'INVALID_PAYLOAD', 'isActive must be boolean', corsHeaders);
          return true;
        }
        try {
          if (isActive === false) {
            const updated = await db.deactivateRiskFlag(banId);
            if (!updated) {
              sendError(res, 404, 'NOT_FOUND', 'Ban not found', corsHeaders);
              return true;
            }
            await db.writeAdminAuditLog({
              adminId: 'admin',
              action: 'UNBAN_GUEST',
              targetType: 'risk_flag',
              targetId: banId,
              details: bodyRes.data,
              ipFingerprint
            });
          }
          sendJson(res, 200, { success: true, banId, isActive }, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        }
        return true;
      }

      // 25. /api/admin/metrics
      if (req.method === 'GET' && pathname === '/api/admin/metrics') {
        try {
          const metrics = await db.getAdminMetrics();
          sendJson(res, 200, metrics, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database service is currently unavailable', corsHeaders);
        }
        return true;
      }

      // 26. /api/admin/analytics
      if (req.method === 'GET' && pathname === '/api/admin/analytics') {
        const rawDays = Number(parsedUrl.searchParams.get('days') || '30');
        const days = Number.isSafeInteger(rawDays) ? Math.max(1, Math.min(90, rawDays)) : 30;
        try {
          const analytics = await db.getAnalyticsSummary(days);
          sendJson(res, 200, analytics, corsHeaders);
        } catch {
          sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Analytics data is temporarily unavailable', corsHeaders);
        }
        return true;
      }
    }

    // Fallthrough for unmatched /api/*
    sendError(res, 404, 'NOT_FOUND', 'Endpoint not found', corsHeaders);
    return true;
  };
}
